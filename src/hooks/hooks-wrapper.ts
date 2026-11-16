import path from 'node:path';
import type { Hooks } from '@opencode-ai/plugin';
import {
  HookEvent,
  HookRunState,
  isHostEventName,
  type DispatchableEvent,
  type HookEventName,
  type HookRegistryEntry,
  type HookScan,
  type HooksWrapperOptions,
} from '../types/hook-types.js';
import type { OwflowMutationEnvelope } from '../types/hook-mutation-types.js';
import { hooksDirectory } from '../utils/workflow-paths.js';
import { scanHooks } from './hooks-registry.js';
import { CircuitBreakerTracker } from './runtime/circuit-breaker.js';
import {
  HookFailureTracker,
  MAX_HOOK_FAILURES,
  SessionAbortController,
  buildCircuitBreakerError,
  buildInterpreterUnavailableError,
  buildProcessFailureError,
  buildSpawnError,
} from './runtime/failure-policy.js';
import {
  applyHookMutation,
  buildMutationNotice,
  isMutableHookEvent,
  parseMutationEnvelope,
} from './runtime/mutation-protocol.js';
import { HookSpawnError, executeHookProcess } from './runtime/process-executor.js';
import { NON_SESSION_STREAM_CAP_BYTES, StatusRecorder } from './runtime/status-recorder.js';
import { writeHookCrashLog } from './hooks-persistence.js';

export { CircuitBreakerTracker, type CircuitBreakerEntry } from './runtime/circuit-breaker.js';

export {
  HookFailureTracker,
  MAX_HOOK_FAILURES,
  SessionAbortController,
  buildCircuitBreakerError,
  buildInterpreterUnavailableError,
  buildSpawnError,
  buildProcessFailureError,
} from './runtime/failure-policy.js';

export { HookSpawnError, executeHookProcess } from './runtime/process-executor.js';

export { NON_SESSION_STREAM_CAP_BYTES, StatusRecorder } from './runtime/status-recorder.js';

class HooksWrapper {
  private PASSTHROUGH_EVENTS = [
    HookEvent.ToolExecuteAfter,
    HookEvent.ToolDefinition,
    HookEvent.ChatParams,
    HookEvent.ChatHeaders,
    HookEvent.CommandExecuteBefore,
    HookEvent.ShellEnv,
    HookEvent.Dispose,
  ] as const satisfies readonly DispatchableEvent[];

  private IDENTITY_KEYS = ['id', 'sessionID', 'messageID', 'partID', 'callID', 'providerID', 'type', 'name', 'tool'];

  public snapshot: HookScan;

  private statusRecorder: StatusRecorder;
  private abortController: SessionAbortController;
  private circuitBreaker: CircuitBreakerTracker;
  private failureTracker: HookFailureTracker;
  private activeProcs: Set<ReturnType<typeof Bun.spawn>>;
  private directory: string;
  private runCounter = 0;

  constructor(directory: string, endSession?: (sessionID: string) => Promise<void> | void, options: HooksWrapperOptions = {}) {
    this.snapshot = scanHooks(hooksDirectory(directory));
    this.directory = directory;

    this.statusRecorder = new StatusRecorder({
      directory,
      statusFile: options.statusFile,
      logFile: options.logFile,
    });
    this.abortController = new SessionAbortController(endSession);
    this.circuitBreaker = new CircuitBreakerTracker();
    this.failureTracker = new HookFailureTracker();
    this.activeProcs = new Set<ReturnType<typeof Bun.spawn>>();
  }

  private sessionIDFrom = (input: unknown): string | undefined => {
    const rec = input as Record<string, any> | undefined;
    const candidate =
      rec?.sessionID ?? rec?.event?.properties?.sessionID ?? rec?.event?.properties?.part?.sessionID ?? rec?.event?.properties?.info?.sessionID;
    return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
  };

  // shortcut: JSON.stringify replacer strips class-instance internals to id/name/type/sessionID instead of a recursive AST projector;
  // ceiling: host objects with throwing getters or deep circular refs;
  // upgrade: explicit per-event context projection.
  private buildStdinPayload = (event: HookEventName, input: unknown, output: unknown, sessionID?: string): string => {
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
              for (const k of this.IDENTITY_KEYS) {
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

  public dispose = (): void => {
    this.statusRecorder.dispose();
    this.failureTracker.clear();
    for (const proc of this.activeProcs) {
      try {
        proc.kill();
      } catch {}
    }
    this.activeProcs.clear();
  };

  public dispatch = async (event: HookEventName, input?: unknown, output?: Record<string, unknown>): Promise<void> => {
    const byEvent = Map.groupBy(this.snapshot.entries, (e) => e.event);

    const sessionID = this.sessionIDFrom(input);
    if (event === HookEvent.ChatMessage && sessionID) {
      this.abortController.clearSession(sessionID);
    }

    const hooks = byEvent.get(event);
    if (!hooks || hooks.length === 0) return;

    const stdinText = this.buildStdinPayload(event, input, output, sessionID);

    for (const entry of hooks) {
      this.runCounter += 1;
      const runId = `${event}#${this.runCounter}`;
      const startedAt = Date.now();
      const name = path.basename(entry.path, path.extname(entry.path));

      const cbCheck = this.circuitBreaker.check(event, entry.path, sessionID, startedAt);
      if (cbCheck.tripped) {
        const reason = cbCheck.reason!;
        this.statusRecorder.setStatus(event, {
          status: HookRunState.FAILURE,
          startedAt,
          finishedAt: startedAt,
          durationMs: 0,
          reason,
          ...(sessionID ? { sessionID } : {}),
        });
        this.statusRecorder.flushStatus();
        this.statusRecorder.appendLog({
          version: 1,
          runId,
          pid: process.pid,
          workspace: this.directory,
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
        this.statusRecorder.setStatus(event, {
          status: HookRunState.FAILURE,
          startedAt,
          finishedAt: startedAt,
          durationMs: 0,
          reason,
          ...(sessionID ? { sessionID } : {}),
        });
        this.statusRecorder.flushStatus();
        this.statusRecorder.appendLog({
          version: 1,
          runId,
          pid: process.pid,
          workspace: this.directory,
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
        await this.abortController.abortSession(event, sessionID, entry.path);
        throw buildInterpreterUnavailableError(entry.path, label);
      }

      const previousStatus = this.statusRecorder.getStatus(event);
      this.statusRecorder.setStatus(event, {
        status: HookRunState.PENDING,
        startedAt,
        ...(sessionID ? { sessionID } : {}),
      });
      this.statusRecorder.schedulePendingStatus();

      let execResult;
      try {
        execResult = await executeHookProcess({
          entry,
          directory: this.directory,
          stdinText,
          event,
          startedAt,
          activeProcs: this.activeProcs,
        });
      } catch (spawnError) {
        if (spawnError instanceof HookSpawnError) {
          const finishedAt = Date.now();
          const spawnErrMsg = spawnError.originalError instanceof Error ? spawnError.originalError.message : String(spawnError.originalError);
          const reason = `failed to spawn ${entry.path}: ${spawnErrMsg}`;
          this.statusRecorder.setStatus(event, {
            status: HookRunState.FAILURE,
            startedAt,
            finishedAt,
            durationMs: 0,
            reason,
            ...(sessionID ? { sessionID } : {}),
          });
          this.statusRecorder.flushStatus();
          this.statusRecorder.appendLog({
            version: 1,
            runId,
            pid: process.pid,
            workspace: this.directory,
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
          await this.abortController.abortSession(event, sessionID, entry.path);
          throw buildSpawnError(entry.path, spawnErrMsg, event);
        }
        throw spawnError;
      }

      const { ok, exitCode, signal, reason, durationMs, finishedAt, rawStdout, rawStderr } = execResult;

      const mutable = isMutableHookEvent(event);
      let isOk = ok;
      let effectiveReason = reason;
      let envelope: OwflowMutationEnvelope | undefined;
      let protocolError: string | undefined;
      let notice: string | undefined;

      if (mutable) {
        try {
          const parsed = parseMutationEnvelope(rawStdout);
          if (parsed.kind === 'mutation') envelope = parsed.envelope;
        } catch (error) {
          protocolError = error instanceof Error ? error.message : String(error);
          if (isOk) {
            isOk = false;
            effectiveReason = `invalid mutation payload: ${protocolError}`;
          } else {
            effectiveReason = `${effectiveReason ?? 'hook failed'}; invalid mutation payload: ${protocolError}`;
          }
        }
      }

      if (!isOk && envelope) {
        effectiveReason = rawStderr.trim() || envelope.reason?.trim() || envelope.hint.trim() || 'hook failed';
      }

      const criticalSource = envelope
        ? `${rawStderr}\n${envelope.reason ?? ''}`
        : protocolError
          ? rawStderr
          : `${rawStderr}\n${rawStdout}`;
      let isCritical = !isOk && criticalSource.includes('CRITICAL:');

      const attemptPeek =
        !isOk && (event === HookEvent.ToolExecuteAfter || event === HookEvent.ToolExecuteBefore)
          ? this.failureTracker.getCount(event, entry.path, sessionID) + 1
          : undefined;
      const canApplyMutation =
        envelope !== undefined && (isOk || (!isCritical && attemptPeek !== undefined && attemptPeek < MAX_HOOK_FAILURES));

      if (canApplyMutation && envelope !== undefined) {
        try {
          notice = buildMutationNotice(name, envelope.hint);
          applyHookMutation(event, output, envelope.mutate, notice);
        } catch (error) {
          protocolError = error instanceof Error ? error.message : String(error);
          notice = undefined;
          if (isOk) {
            isOk = false;
            isCritical = false;
            effectiveReason = `invalid mutation payload: ${protocolError}`;
          } else {
            effectiveReason = `${effectiveReason ?? 'hook failed'}; invalid mutation payload: ${protocolError}`;
          }
        }
      }

      let attempt: number | undefined;
      if (isOk) {
        this.circuitBreaker.recordSuccess(event, entry.path, sessionID);
        this.failureTracker.recordSuccess(event, entry.path, sessionID);
      } else {
        this.circuitBreaker.recordFailure(event, entry.path, sessionID, startedAt, finishedAt);
        if (event === HookEvent.ToolExecuteAfter || event === HookEvent.ToolExecuteBefore) {
          attempt = this.failureTracker.recordFailure(event, entry.path, sessionID);
        }
      }

      if (isOk && notice !== undefined) {
        effectiveReason = notice;
        if (event === HookEvent.ToolExecuteAfter && output) this.appendOutputNotice(output, notice);
      } else if (isOk && event === HookEvent.ToolExecuteAfter && rawStdout.trim() && output) {
        this.appendPostToolHint(output, rawStdout.trim());
      }

      const runReason = notice && !isOk ? `${effectiveReason}\n\n${notice}` : effectiveReason;

      // Silent successful catch-all `event` runs leave no status/log trace so hot bus events don't flood.
      if (isOk && event === HookEvent.Event && !rawStdout.trim() && !rawStderr.trim()) {
        if (previousStatus) this.statusRecorder.setStatus(event, previousStatus);
        else this.statusRecorder.deleteStatus(event);
        this.statusRecorder.flushStatus();
        continue;
      }

      this.statusRecorder.setStatus(event, {
        status: isOk ? HookRunState.SUCCESS : HookRunState.FAILURE,
        startedAt,
        finishedAt,
        durationMs,
        ...(runReason ? { reason: runReason } : {}),
        ...(sessionID ? { sessionID } : {}),
      });
      this.statusRecorder.flushStatus();

      const loggedStdout =
        !sessionID && rawStdout.length > NON_SESSION_STREAM_CAP_BYTES ? rawStdout.slice(0, NON_SESSION_STREAM_CAP_BYTES) : rawStdout;
      const loggedStderr =
        !sessionID && rawStderr.length > NON_SESSION_STREAM_CAP_BYTES ? rawStderr.slice(0, NON_SESSION_STREAM_CAP_BYTES) : rawStderr;

      this.statusRecorder.appendLog({
        version: 1,
        runId,
        pid: process.pid,
        workspace: this.directory,
        event,
        hook: entry.path,
        name,
        ...(sessionID ? { sessionID } : {}),
        startedAt,
        finishedAt,
        durationMs,
        status: isOk ? HookRunState.SUCCESS : HookRunState.FAILURE,
        exitCode,
        ...(signal ? { signal } : {}),
        ...(runReason ? { reason: runReason } : {}),
        ...(loggedStdout ? { stdout: loggedStdout } : {}),
        ...(loggedStderr ? { stderr: loggedStderr } : {}),
      });

      if (!isOk) {
        const shouldContinue = await this.handleFailure({
          event,
          entry,
          sessionID,
          output,
          baseReason: effectiveReason,
          notice,
          attempt,
          isCritical,
        });
        if (shouldContinue) continue;
      }
    }
  };

  private appendOutputNotice = (output: Record<string, unknown>, notice: string): void => {
    const existing = typeof output.output === 'string' ? output.output : '';
    output.output = existing ? `${existing}\n\n${notice}` : notice;
  };

  private appendPostToolHint = (output: Record<string, unknown>, stdout: string): void => {
    const existing = typeof output.output === 'string' ? output.output : '';
    output.output = existing ? `${existing}\n\n[Post-Tool Hint]:\n${stdout}` : stdout;
  };

  private handleFailure = async (context: {
    event: HookEventName;
    entry: HookRegistryEntry;
    sessionID?: string;
    output?: Record<string, unknown>;
    baseReason?: string;
    notice?: string;
    attempt?: number;
    isCritical: boolean;
  }): Promise<boolean> => {
    const { event, entry, sessionID, output, baseReason, notice, isCritical } = context;

    if (event === HookEvent.ToolExecuteAfter) {
      const attempt = context.attempt ?? MAX_HOOK_FAILURES;
      if (attempt < MAX_HOOK_FAILURES && !isCritical) {
        if (output && typeof output === 'object') {
          const hintBody = baseReason || 'Check failed';
          const failureBlock = `[Post-Tool Check Failed (attempt ${attempt}/${MAX_HOOK_FAILURES})]:\n${hintBody}\nHint: Fix the reported issues to keep code quality standards.`;
          this.appendOutputNotice(output, notice ? `${failureBlock}\n\n${notice}` : failureBlock);
        }
        return true;
      }
      await this.abortController.abortSession(event, sessionID, entry.path);
      throw buildProcessFailureError(entry.path, baseReason, event, isCritical ? MAX_HOOK_FAILURES : attempt, MAX_HOOK_FAILURES);
    }

    if (event === HookEvent.ToolExecuteBefore) {
      const attempt = context.attempt ?? MAX_HOOK_FAILURES;
      if (attempt < MAX_HOOK_FAILURES && !isCritical) {
        const error = buildProcessFailureError(entry.path, baseReason, event, attempt, MAX_HOOK_FAILURES);
        if (notice) error.message = `${error.message} ${notice}`;
        throw error;
      }
      await this.abortController.abortSession(event, sessionID, entry.path);
      throw buildProcessFailureError(entry.path, baseReason, event, isCritical ? MAX_HOOK_FAILURES : attempt, MAX_HOOK_FAILURES);
    }

    await this.abortController.abortSession(event, sessionID, entry.path);
    throw buildProcessFailureError(entry.path, baseReason, event);
  };

  public createDispatchHandlers = (): Hooks => {
    const handlers = Object.fromEntries(
      this.PASSTHROUGH_EVENTS.map((event) => [event, (input?: unknown, output?: Record<string, unknown>) => this.dispatch(event, input, output)]),
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
              await this.dispatch(type, input);
            } catch (error) {
              writeHookCrashLog(this.directory, `reactive_host_event_${type}`, error);
            }
          });
        }
        await runSerialized(HookEvent.Event, async () => {
          try {
            await this.dispatch(HookEvent.Event, input);
          } catch (error) {
            writeHookCrashLog(this.directory, 'catch_all_event_hook', error);
          }
        });
      },
    };
  };
}

export { HooksWrapper };
export default HooksWrapper;
