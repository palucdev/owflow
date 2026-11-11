import fs from 'node:fs';
import path from 'node:path';
import type { Hooks } from '@opencode-ai/plugin';
import {
  HookEvent,
  HookRunState,
  isHostEventName,
  type DispatchableEvent,
  type Dispatcher,
  type HookEventName,
  type HookRegistryEntry,
  type HookRunLogRecord,
  type HookRuntimeEntry,
  type HookStatusSnapshot,
  type HooksWrapper,
  type HooksWrapperOptions,
} from '../types/hook-types.js';
import { hooksDirectory } from '../utils/workflow-paths.js';
import { appendWithRotation, resolveHooksLatestSymlink, resolveHooksLogFile, resolveHooksStatusFile } from './hooks-persistence.js';
import { scanHooks } from './hooks-registry.js';

export const DEFAULT_HOOK_TIMEOUT_MS = 120_000;
export const HOOK_TIMEOUT_ENV = 'OWFLOW_HOOK_TIMEOUT_MS';
export const MAX_LOG_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_STREAM_BUFFER_BYTES = 4 * 1024 * 1024;
export const NON_SESSION_STREAM_CAP_BYTES = 16 * 1024;
export const ABORT_COOLDOWN_MS = 2_000;
export const CIRCUIT_BREAKER_THRESHOLD = 4;
export const CIRCUIT_BREAKER_RAPID_GAP_MS = 500;
export const CIRCUIT_BREAKER_COOLDOWN_MS = 30_000;

interface CircuitBreakerEntry {
  rapidFailures: number;
  lastFinishedAt: number;
  trippedUntil: number;
}

// Reactive host events (e.g. session.idle) and the catch-all event hook notify after state transitions;
// aborting a session on session.idle forces OpenCode back to idle and re-emits session.idle in a tight loop.
export const canAbortSessionForEvent = (event: HookEventName): boolean => !isHostEventName(event) && event !== HookEvent.Event;

const IDENTITY_KEYS = ['id', 'sessionID', 'messageID', 'partID', 'callID', 'providerID', 'type', 'name', 'tool'];

// shortcut: JSON.stringify replacer strips class-instance internals to id/name/type/sessionID instead of a recursive AST projector;
// ceiling: host objects with throwing getters or deep circular refs;
// upgrade: explicit per-event context projection.
export const buildStdinPayload = (event: HookEventName, input: unknown, output: unknown, sessionID?: string): string => {
  const context: Record<string, unknown> = {};
  for (const src of [input, output]) {
    if (typeof src === 'object' && src !== null && !Array.isArray(src)) {
      Object.assign(context, src);
    }
  }
  const seen = new WeakSet<object>();
  return JSON.stringify(
    {
      event,
      ...(sessionID ? { session: { sessionID } } : {}),
      context,
    },
    (_key, value) => {
      if (typeof value === 'bigint') return value.toString();
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
        if (!Array.isArray(value)) {
          const proto = Object.getPrototypeOf(value);
          if (proto !== Object.prototype && proto !== null) {
            const picked: Record<string, unknown> = {};
            for (const k of IDENTITY_KEYS) {
              if (value[k] !== undefined) picked[k] = value[k];
            }
            return picked;
          }
        }
      }
      return value;
    },
  );
};

const sessionIDFrom = (input: unknown): string | undefined => {
  const rec = input as Record<string, any> | undefined;
  const candidate =
    rec?.sessionID ?? rec?.event?.properties?.sessionID ?? rec?.event?.properties?.part?.sessionID ?? rec?.event?.properties?.info?.sessionID;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
};

export const readStream = async (
  stream: ReadableStream<Uint8Array> | null | undefined,
  onChunk?: (chunk: string) => void,
  maxBytes = MAX_STREAM_BUFFER_BYTES,
): Promise<string> => {
  if (!stream) return '';
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = '';
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      const chunk = decoder.decode(value, { stream: true });
      if (chunk) {
        if (result.length < maxBytes) {
          result += chunk.slice(0, maxBytes - result.length);
        }
        onChunk?.(chunk);
      }
      if (totalBytes >= maxBytes) {
        try {
          await reader.cancel('Stream limit exceeded');
        } catch {}
        break;
      }
    }
    const tail = decoder.decode();
    if (tail) {
      if (result.length < maxBytes) {
        result += tail.slice(0, maxBytes - result.length);
      }
      onChunk?.(tail);
    }
  } catch {}
  return result;
};

export const STATUS_DEBOUNCE_MS = 50;

export const flushStatusFileAtomic = (file: string, workspace: string, hooks: ReadonlyMap<string, HookRuntimeEntry>): void => {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    try {
      if (fs.lstatSync(file).isSymbolicLink()) return;
    } catch (err: any) {
      if (err?.code !== 'ENOENT') return;
    }
    const snapshot: HookStatusSnapshot = {
      version: 1,
      pid: process.pid,
      workspace,
      updatedAt: Date.now(),
      hooks: Object.fromEntries(hooks),
    };
    const tmpFile = `${file}.${process.pid}.tmp`;
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | (fs.constants.O_NOFOLLOW ?? 0);
    const fd = fs.openSync(tmpFile, flags, 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(snapshot), { encoding: 'utf8' });
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmpFile, file);
  } catch {
    try {
      fs.unlinkSync(`${file}.${process.pid}.tmp`);
    } catch {}
    // Best-effort status persistence never affects hook execution.
  }
};

export const buildExecutionArgs = (entry: HookRegistryEntry): string[] => {
  const resolvedLower = (entry.interpreter.resolved ?? '').toLowerCase();
  const isPowerShell =
    entry.path.endsWith('.ps1') || entry.interpreter.expected === 'pwsh' || resolvedLower.includes('powershell') || resolvedLower.includes('pwsh');

  if (isPowerShell) {
    return [entry.interpreter.resolved!, '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', entry.path];
  }

  return [entry.interpreter.resolved!, entry.path];
};

export const initializeHooksWrapper = async (
  directory: string,
  endSession?: (sessionID: string) => Promise<void> | void,
  options: HooksWrapperOptions = {},
): Promise<HooksWrapper> => {
  const { entries } = scanHooks(hooksDirectory(directory));
  const byEvent = Map.groupBy(entries, (e) => e.event);
  const statusFile = options.statusFile ?? resolveHooksStatusFile(directory);
  resolveHooksLatestSymlink(directory);
  const statuses = new Map<string, HookRuntimeEntry>();
  const activeProcs = new Set<ReturnType<typeof Bun.spawn>>();
  const abortingSessions = new Map<string, number>();
  const breakers = new Map<string, CircuitBreakerEntry>();
  let runCounter = 0;
  const writtenRunRecords = new Set<string>();
  let statusTimer: ReturnType<typeof setTimeout> | undefined;

  const flushStatus = (): void => {
    if (statusTimer !== undefined) {
      clearTimeout(statusTimer);
      statusTimer = undefined;
    }
    flushStatusFileAtomic(statusFile, directory, statuses);
  };

  const schedulePendingStatus = (): void => {
    if (statusTimer !== undefined) {
      clearTimeout(statusTimer);
    }
    statusTimer = setTimeout(() => {
      statusTimer = undefined;
      flushStatusFileAtomic(statusFile, directory, statuses);
    }, STATUS_DEBOUNCE_MS);
    statusTimer.unref?.();
  };

  flushStatus();

  const appendLog = (record: HookRunLogRecord): void => {
    try {
      // Distinguish distinct runs by runId and terminal status
      const recordKey = `${record.runId}:${record.status}`;
      if (writtenRunRecords.has(recordKey)) return;

      const targetLogFile = options.logFile ?? resolveHooksLogFile(directory, record.name);
      appendWithRotation(targetLogFile, JSON.stringify(record));
      if (!options.logFile) {
        resolveHooksLatestSymlink(directory, targetLogFile);
      }
      writtenRunRecords.add(recordKey);

      // Bounded set eviction to prevent memory growth across thousands of runs
      if (writtenRunRecords.size > 1000) {
        const oldest = writtenRunRecords.values().next().value;
        if (oldest) writtenRunRecords.delete(oldest);
      }
    } catch {
      // Best-effort log persistence never affects hook execution.
    }
  };

  const abortSession = async (event: HookEventName, sessionID: string | undefined, scriptPath: string): Promise<void> => {
    if (!endSession || !sessionID || !canAbortSessionForEvent(event)) return;
    const now = Date.now();
    const lastAbort = abortingSessions.get(sessionID);
    if (lastAbort !== undefined && now - lastAbort < ABORT_COOLDOWN_MS) return;
    abortingSessions.set(sessionID, now);
    try {
      await endSession(sessionID);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[owflow] hooks: failed to end session ${sessionID} after ${scriptPath} failed: ${msg}`);
    }
  };

  const dispatch: Dispatcher = async (event, input, output) => {
    const sessionID = sessionIDFrom(input);
    if (event === HookEvent.ChatMessage && sessionID) {
      abortingSessions.delete(sessionID);
    }

    const hooks = byEvent.get(event);
    if (!hooks || hooks.length === 0) return;

    const stdinText = buildStdinPayload(event, input, output, sessionID);

    for (const entry of hooks) {
      runCounter += 1;
      const runId = `${event}#${runCounter}`;
      const startedAt = Date.now();
      const name = path.basename(entry.path, path.extname(entry.path));
      const breakerKey = `${event}::${entry.path}::${sessionID ?? 'global'}`;
      const breaker = breakers.get(breakerKey);
      if (breaker && startedAt < breaker.trippedUntil) {
        const reason = `Circuit breaker active for ${entry.path} after ${CIRCUIT_BREAKER_THRESHOLD} rapid consecutive failures (cooldown until ${new Date(breaker.trippedUntil).toISOString()})`;
        statuses.set(event, {
          status: HookRunState.FAILURE,
          startedAt,
          finishedAt: startedAt,
          durationMs: 0,
          reason,
          ...(sessionID ? { sessionID } : {}),
        });
        flushStatus();
        appendLog({
          version: 1,
          runId,
          pid: process.pid,
          workspace: directory,
          event,
          hook: entry.path,
          name,
          ...(sessionID ? { sessionID } : {}),
          startedAt,
          finishedAt: startedAt,
          durationMs: 0,
          status: HookRunState.FAILURE,
          reason,
        });
        throw new Error(`Blocked: ${reason}. Hint: fix ${entry.path} or wait for cooldown.`);
      }

      if (!entry.interpreter.available || !entry.interpreter.resolved) {
        const label = entry.interpreter.resolved ?? entry.interpreter.expected;
        const reason = `${label} is not available`;
        statuses.set(event, {
          status: HookRunState.FAILURE,
          startedAt,
          finishedAt: startedAt,
          durationMs: 0,
          reason,
          ...(sessionID ? { sessionID } : {}),
        });
        flushStatus();
        appendLog({
          version: 1,
          runId,
          pid: process.pid,
          workspace: directory,
          event,
          hook: entry.path,
          name,
          ...(sessionID ? { sessionID } : {}),
          startedAt,
          finishedAt: startedAt,
          durationMs: 0,
          status: HookRunState.FAILURE,
          reason,
        });
        await abortSession(event, sessionID, entry.path);
        throw new Error(
          `Blocked: hook ${entry.path} cannot run: the ${label} interpreter is not available. ` +
            `Hint: install ${label} and restart OpenCode, or remove the script to stop failing closed.`,
        );
      }

      const previousStatus = statuses.get(event);
      statuses.set(event, {
        status: HookRunState.PENDING,
        startedAt,
        ...(sessionID ? { sessionID } : {}),
      });
      schedulePendingStatus();

      if (process.env.OWFLOW_DEBUG === '1') {
        console.error(`[owflow:debug] [${event}] Spawning ${entry.path} (stdin: ${stdinText.length} bytes)`);
      }

      let proc: ReturnType<typeof Bun.spawn>;
      try {
        proc = Bun.spawn(buildExecutionArgs(entry), {
          cwd: directory,
          stdin: Buffer.from(stdinText),
          stdout: 'pipe',
          stderr: 'pipe',
        });
        activeProcs.add(proc);
      } catch (spawnError) {
        const finishedAt = Date.now();
        const spawnErrMsg = spawnError instanceof Error ? spawnError.message : String(spawnError);
        const reason = `failed to spawn ${entry.path}: ${spawnErrMsg}`;
        statuses.set(event, {
          status: HookRunState.FAILURE,
          startedAt,
          finishedAt,
          durationMs: 0,
          reason,
          ...(sessionID ? { sessionID } : {}),
        });
        flushStatus();
        appendLog({
          version: 1,
          runId,
          pid: process.pid,
          workspace: directory,
          event,
          hook: entry.path,
          name,
          ...(sessionID ? { sessionID } : {}),
          startedAt,
          finishedAt,
          durationMs: 0,
          status: HookRunState.FAILURE,
          reason,
        });
        await abortSession(event, sessionID, entry.path);
        const failPosture = canAbortSessionForEvent(event) ? 'failure ends the current session; fail closed' : 'failure recorded; fail closed';
        throw new Error(
          `Blocked: failed to spawn hook ${entry.path}: ${spawnErrMsg}. Hint: fix the failing script ${entry.path} (${failPosture}), or remove it and restart OpenCode to proceed.`,
        );
      }

      const rawTimeout = process.env[HOOK_TIMEOUT_ENV];
      let timeoutMs = DEFAULT_HOOK_TIMEOUT_MS;
      if (rawTimeout !== undefined) {
        const parsed = Number(rawTimeout);
        if (Number.isFinite(parsed) && parsed <= 0) {
          timeoutMs = 0;
        } else if (Number.isFinite(parsed)) {
          timeoutMs = parsed;
        }
      }

      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let rawStdout = '';
      let rawStderr = '';
      const ioPromise = Promise.all([
        readStream(proc.stdout as ReadableStream<Uint8Array> | null | undefined),
        readStream(proc.stderr as ReadableStream<Uint8Array> | null | undefined),
        proc.exited,
      ]);

      let exitCode: number | null = null;
      try {
        const res =
          timeoutMs > 0
            ? await Promise.race([
                ioPromise,
                new Promise<'timeout'>((resolve) => {
                  timer = setTimeout(() => {
                    timedOut = true;
                    try {
                      proc.kill();
                    } catch {}
                    resolve('timeout');
                  }, Math.floor(timeoutMs));
                  timer.unref?.();
                }),
              ])
            : await ioPromise;
        if (res !== 'timeout') [rawStdout, rawStderr, exitCode] = res;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        activeProcs.delete(proc);
      }

      const finishedAt = Date.now();
      const durationMs = Math.max(0, finishedAt - startedAt);
      const signal = proc.signalCode ?? null;
      const ok = !timedOut && exitCode === 0 && signal === null;

      if (process.env.OWFLOW_DEBUG === '1') {
        console.error(`[owflow:debug] [${event}] Finished ${entry.path} in ${durationMs}ms (exitCode: ${exitCode}, ok: ${ok})`);
      }

      if (ok) {
        breakers.delete(breakerKey);
      } else {
        const prev = breakers.get(breakerKey);
        const isRapid = prev !== undefined && startedAt - prev.lastFinishedAt <= CIRCUIT_BREAKER_RAPID_GAP_MS;
        const rapidFailures = isRapid ? prev.rapidFailures + 1 : 1;
        const trippedUntil = rapidFailures >= CIRCUIT_BREAKER_THRESHOLD ? finishedAt + CIRCUIT_BREAKER_COOLDOWN_MS : 0;

        breakers.set(breakerKey, {
          rapidFailures,
          lastFinishedAt: finishedAt,
          trippedUntil,
        });

        if (trippedUntil > 0) {
          console.warn(
            `[owflow] hooks: circuit breaker tripped for ${entry.path} on event "${event}" after ${rapidFailures} rapid failures; pausing for ${CIRCUIT_BREAKER_COOLDOWN_MS}ms.`,
          );
        }
      }

      // Silent successful catch-all `event` runs leave no status/log trace so hot bus events don't flood.
      if (ok && event === HookEvent.Event && !rawStdout.trim() && !rawStderr.trim()) {
        if (previousStatus) statuses.set(event, previousStatus);
        else statuses.delete(event);
        flushStatus();
        continue;
      }

      const reason = ok
        ? undefined
        : timedOut
          ? `process timed out after ${Math.floor(timeoutMs)}ms`
          : rawStderr.trim() || rawStdout.trim() || (signal ? `process terminated by signal ${signal}` : `process exited with code ${exitCode}`);

      statuses.set(event, {
        status: ok ? HookRunState.SUCCESS : HookRunState.FAILURE,
        startedAt,
        finishedAt,
        durationMs,
        ...(reason ? { reason } : {}),
        ...(sessionID ? { sessionID } : {}),
      });
      flushStatus();

      const loggedStdout =
        !sessionID && rawStdout.length > NON_SESSION_STREAM_CAP_BYTES ? rawStdout.slice(0, NON_SESSION_STREAM_CAP_BYTES) : rawStdout;
      const loggedStderr =
        !sessionID && rawStderr.length > NON_SESSION_STREAM_CAP_BYTES ? rawStderr.slice(0, NON_SESSION_STREAM_CAP_BYTES) : rawStderr;

      appendLog({
        version: 1,
        runId,
        pid: process.pid,
        workspace: directory,
        event,
        hook: entry.path,
        name,
        ...(sessionID ? { sessionID } : {}),
        startedAt,
        finishedAt,
        durationMs,
        status: ok ? HookRunState.SUCCESS : HookRunState.FAILURE,
        exitCode,
        ...(signal ? { signal } : {}),
        ...(reason ? { reason } : {}),
        ...(loggedStdout ? { stdout: loggedStdout } : {}),
        ...(loggedStderr ? { stderr: loggedStderr } : {}),
      });

      if (!ok) {
        await abortSession(event, sessionID, entry.path);
        const body = reason?.startsWith('Blocked:') ? reason : `Blocked: ${reason || `hook ${entry.path} failed`}`;
        const failPosture = canAbortSessionForEvent(event) ? 'failure ends the current session; fail closed' : 'failure recorded; fail closed';
        throw new Error(
          `${body.endsWith('.') ? body : `${body}.`} Hint: fix the failing script ${entry.path} (${failPosture}), or remove it and restart OpenCode to proceed.`,
        );
      }
    }
  };

  return {
    dispatch,
    snapshot: { entries },
    dispose: () => {
      flushStatus();
      for (const proc of activeProcs) {
        try {
          proc.kill();
        } catch {}
      }
      activeProcs.clear();
    },
  };
};

export const PASSTHROUGH_EVENTS = [
  HookEvent.ToolExecuteAfter,
  HookEvent.ToolDefinition,
  HookEvent.ChatParams,
  HookEvent.ChatHeaders,
  HookEvent.CommandExecuteBefore,
  HookEvent.ShellEnv,
  HookEvent.ExperimentalChatMessagesTransform,
  HookEvent.ExperimentalChatSystemTransform,
  HookEvent.ExperimentalCompactionAutocontinue,
  HookEvent.ExperimentalTextComplete,
  HookEvent.Dispose,
] as const satisfies readonly DispatchableEvent[];

export const createDispatchHandlers = (dispatch: Dispatcher): Hooks => {
  const handlers = Object.fromEntries(
    PASSTHROUGH_EVENTS.map((event) => [event, (input?: unknown, output?: Record<string, unknown>) => dispatch(event, input, output)]),
  ) as Hooks;

  const chains = new Map<string, Promise<void>>();
  const runSerialized = (key: string, task: () => Promise<void>): Promise<void> => {
    const next = (chains.get(key) ?? Promise.resolve()).catch(() => {}).then(task);
    const tracked = next.finally(() => {
      if (chains.get(key) === tracked) chains.delete(key);
    });
    tracked.catch(() => {});
    chains.set(key, tracked);
    return next;
  };

  return {
    ...handlers,
    [HookEvent.Event]: async (input: unknown) => {
      const type = (input as { event?: { type?: unknown } } | undefined)?.event?.type;
      if (typeof type === 'string' && isHostEventName(type) && !chains.has(type)) {
        await runSerialized(type, async () => {
          try {
            await dispatch(type, input);
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.warn(`[owflow] reactive host event "${type}" failed: ${msg}`);
          }
        });
      }
      await runSerialized(HookEvent.Event, async () => {
        try {
          await dispatch(HookEvent.Event, input);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          console.warn(`[owflow] catch-all event hook failed: ${msg}`);
        }
      });
    },
  };
};
