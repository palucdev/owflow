import path from 'node:path';
import type { Hooks } from '@opencode-ai/plugin';
import {
  HookEvent,
  HookRunState,
  isHostEventName,
  type DispatchableEvent,
  type Dispatcher,
  type HookEventName,
  type HooksWrapper,
  type HooksWrapperOptions,
} from '../types/hook-types.js';
import { hooksDirectory } from '../utils/workflow-paths.js';
import { scanHooks } from './hooks-registry.js';
import {
  CIRCUIT_BREAKER_COOLDOWN_MS,
  CIRCUIT_BREAKER_RAPID_GAP_MS,
  CIRCUIT_BREAKER_THRESHOLD,
  CircuitBreakerTracker,
  type CircuitBreakerEntry,
} from './runtime/circuit-breaker.js';
import {
  ABORT_COOLDOWN_MS,
  SessionAbortController,
  buildCircuitBreakerError,
  buildInterpreterUnavailableError,
  buildProcessFailureError,
  buildSpawnError,
  canAbortSessionForEvent,
} from './runtime/failure-policy.js';
import {
  DEFAULT_HOOK_TIMEOUT_MS,
  HOOK_TIMEOUT_ENV,
  HookSpawnError,
  MAX_STREAM_BUFFER_BYTES,
  buildExecutionArgs,
  executeHookProcess,
  readStream,
  resolveHookTimeoutMs,
} from './runtime/process-executor.js';
import {
  MAX_LOG_FILE_BYTES,
  NON_SESSION_STREAM_CAP_BYTES,
  STATUS_DEBOUNCE_MS,
  StatusRecorder,
  flushStatusFileAtomic,
} from './runtime/status-recorder.js';

export {
  CIRCUIT_BREAKER_THRESHOLD,
  CIRCUIT_BREAKER_RAPID_GAP_MS,
  CIRCUIT_BREAKER_COOLDOWN_MS,
  CircuitBreakerTracker,
  type CircuitBreakerEntry,
} from './runtime/circuit-breaker.js';

export {
  ABORT_COOLDOWN_MS,
  canAbortSessionForEvent,
  SessionAbortController,
  buildCircuitBreakerError,
  buildInterpreterUnavailableError,
  buildSpawnError,
  buildProcessFailureError,
} from './runtime/failure-policy.js';

export {
  DEFAULT_HOOK_TIMEOUT_MS,
  HOOK_TIMEOUT_ENV,
  MAX_STREAM_BUFFER_BYTES,
  HookSpawnError,
  buildExecutionArgs,
  readStream,
  resolveHookTimeoutMs,
  executeHookProcess,
} from './runtime/process-executor.js';

export {
  STATUS_DEBOUNCE_MS,
  MAX_LOG_FILE_BYTES,
  NON_SESSION_STREAM_CAP_BYTES,
  flushStatusFileAtomic,
  StatusRecorder,
} from './runtime/status-recorder.js';

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

export const initializeHooksWrapper = async (
  directory: string,
  endSession?: (sessionID: string) => Promise<void> | void,
  options: HooksWrapperOptions = {},
): Promise<HooksWrapper> => {
  const { entries } = scanHooks(hooksDirectory(directory));
  const byEvent = Map.groupBy(entries, (e) => e.event);

  const statusRecorder = new StatusRecorder({
    directory,
    statusFile: options.statusFile,
    logFile: options.logFile,
  });
  const abortController = new SessionAbortController(endSession);
  const circuitBreaker = new CircuitBreakerTracker();
  const activeProcs = new Set<ReturnType<typeof Bun.spawn>>();
  let runCounter = 0;

  const dispatch: Dispatcher = async (event, input, output) => {
    const sessionID = sessionIDFrom(input);
    if (event === HookEvent.ChatMessage && sessionID) {
      abortController.clearSession(sessionID);
    }

    const hooks = byEvent.get(event);
    if (!hooks || hooks.length === 0) return;

    const stdinText = buildStdinPayload(event, input, output, sessionID);

    for (const entry of hooks) {
      runCounter += 1;
      const runId = `${event}#${runCounter}`;
      const startedAt = Date.now();
      const name = path.basename(entry.path, path.extname(entry.path));

      const cbCheck = circuitBreaker.check(event, entry.path, sessionID, startedAt);
      if (cbCheck.tripped) {
        const reason = cbCheck.reason!;
        statusRecorder.setStatus(event, {
          status: HookRunState.FAILURE,
          startedAt,
          finishedAt: startedAt,
          durationMs: 0,
          reason,
          ...(sessionID ? { sessionID } : {}),
        });
        statusRecorder.flushStatus();
        statusRecorder.appendLog({
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
        throw buildCircuitBreakerError(entry.path, reason);
      }

      if (!entry.interpreter.available || !entry.interpreter.resolved) {
        const label = entry.interpreter.resolved ?? entry.interpreter.expected;
        const reason = `${label} is not available`;
        statusRecorder.setStatus(event, {
          status: HookRunState.FAILURE,
          startedAt,
          finishedAt: startedAt,
          durationMs: 0,
          reason,
          ...(sessionID ? { sessionID } : {}),
        });
        statusRecorder.flushStatus();
        statusRecorder.appendLog({
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
        await abortController.abortSession(event, sessionID, entry.path);
        throw buildInterpreterUnavailableError(entry.path, label);
      }

      const previousStatus = statusRecorder.getStatus(event);
      statusRecorder.setStatus(event, {
        status: HookRunState.PENDING,
        startedAt,
        ...(sessionID ? { sessionID } : {}),
      });
      statusRecorder.schedulePendingStatus();

      let execResult;
      try {
        execResult = await executeHookProcess({
          entry,
          directory,
          stdinText,
          event,
          startedAt,
          activeProcs,
        });
      } catch (spawnError) {
        if (spawnError instanceof HookSpawnError) {
          const finishedAt = Date.now();
          const spawnErrMsg = spawnError.originalError instanceof Error ? spawnError.originalError.message : String(spawnError.originalError);
          const reason = `failed to spawn ${entry.path}: ${spawnErrMsg}`;
          statusRecorder.setStatus(event, {
            status: HookRunState.FAILURE,
            startedAt,
            finishedAt,
            durationMs: 0,
            reason,
            ...(sessionID ? { sessionID } : {}),
          });
          statusRecorder.flushStatus();
          statusRecorder.appendLog({
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
          await abortController.abortSession(event, sessionID, entry.path);
          throw buildSpawnError(entry.path, spawnErrMsg, event);
        }
        throw spawnError;
      }

      const { ok, exitCode, signal, reason, durationMs, finishedAt, rawStdout, rawStderr } = execResult;

      if (ok) {
        circuitBreaker.recordSuccess(event, entry.path, sessionID);
      } else {
        circuitBreaker.recordFailure(event, entry.path, sessionID, startedAt, finishedAt);
      }

      // Silent successful catch-all `event` runs leave no status/log trace so hot bus events don't flood.
      if (ok && event === HookEvent.Event && !rawStdout.trim() && !rawStderr.trim()) {
        if (previousStatus) statusRecorder.setStatus(event, previousStatus);
        else statusRecorder.deleteStatus(event);
        statusRecorder.flushStatus();
        continue;
      }

      statusRecorder.setStatus(event, {
        status: ok ? HookRunState.SUCCESS : HookRunState.FAILURE,
        startedAt,
        finishedAt,
        durationMs,
        ...(reason ? { reason } : {}),
        ...(sessionID ? { sessionID } : {}),
      });
      statusRecorder.flushStatus();

      const loggedStdout =
        !sessionID && rawStdout.length > NON_SESSION_STREAM_CAP_BYTES ? rawStdout.slice(0, NON_SESSION_STREAM_CAP_BYTES) : rawStdout;
      const loggedStderr =
        !sessionID && rawStderr.length > NON_SESSION_STREAM_CAP_BYTES ? rawStderr.slice(0, NON_SESSION_STREAM_CAP_BYTES) : rawStderr;

      statusRecorder.appendLog({
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
        await abortController.abortSession(event, sessionID, entry.path);
        throw buildProcessFailureError(entry.path, reason, event);
      }
    }
  };

  return {
    dispatch,
    snapshot: { entries },
    dispose: () => {
      statusRecorder.dispose();
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
