import path from 'node:path';
import type { Hooks } from '@opencode-ai/plugin';
import {
  HookEvent,
  isHostEventName,
  type DispatchableEvent,
  type HookEventName,
  type HookRunOptions,
  type HookScan,
  type HooksWrapperOptions,
} from '../types/hook-types.js';
import { hooksDirectory } from '../utils/workflow-paths.js';
import { scanHooks } from './hooks-registry.js';
import { CircuitBreakerTracker } from './runtime/circuit-breaker.js';
import { SessionAbortController } from './runtime/failure-policy.js';
import { StatusRecorder } from './runtime/status-recorder.js';
import { writeHookCrashLog } from './hooks-persistence.js';
import { executeHookRun, type HookRunDependencies } from './wrapper/hook-run-executor.js';
import { createEventRunSerializer } from './wrapper/event-run-serializer.js';
import {
  buildStdinPayload as composeStdinPayload,
  eventTypeFrom,
  resolveStdinPayloadOptions,
  sessionIDFrom,
  type StdinPayloadOptions,
} from './wrapper/payload-builder.js';

export { CircuitBreakerTracker, type CircuitBreakerEntry } from './runtime/circuit-breaker.js';

export {
  SessionAbortController,
  buildCircuitBreakerError,
  buildInterpreterUnavailableError,
  buildSpawnError,
  buildProcessFailureError,
} from './runtime/failure-policy.js';

export { HookSpawnError, executeHookProcess } from './runtime/process-executor.js';

export { NON_SESSION_STREAM_CAP_BYTES, StatusRecorder } from './runtime/status-recorder.js';

const PASSTHROUGH_EVENTS = [
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

interface ReactiveRunOptions {
  readonly event: HookEventName;
  readonly input: unknown;
  readonly crashSource: string;
}

class HooksWrapper {
  private readonly statusRecorder: StatusRecorder;
  private readonly abortController: SessionAbortController;
  private readonly circuitBreaker: CircuitBreakerTracker;
  private readonly activeProcesses: Set<ReturnType<typeof Bun.spawn>>;
  private readonly directory: string;
  private runCounter = 0;

  private buildStdinPayload = (eventOrOptions: HookEventName | StdinPayloadOptions, ...rest: readonly unknown[]): string =>
    composeStdinPayload(resolveStdinPayloadOptions(eventOrOptions, rest));

  private createRunDependencies = (): HookRunDependencies => ({
    statusRecorder: this.statusRecorder,
    abortController: this.abortController,
    circuitBreaker: this.circuitBreaker,
    activeProcesses: this.activeProcesses,
    workspace: this.directory,
  });

  private runHookReactive = async (options: ReactiveRunOptions): Promise<void> => {
    try {
      await this.runHook({ event: options.event, input: options.input });
    } catch (error) {
      writeHookCrashLog(this.directory, options.crashSource, error);
    }
  };

  public dispose = (): void => {
    this.statusRecorder.dispose();
    for (const activeProcess of this.activeProcesses) {
      try {
        activeProcess.kill();
      } catch {
        // The process already exited; cleanup is best-effort.
      }
    }
    this.activeProcesses.clear();
  };

  public runHook = async (options: HookRunOptions): Promise<void> => {
    const { event, input, output } = options;
    const resolvedSessionID = sessionIDFrom(input);

    if (resolvedSessionID && event === HookEvent.ChatMessage) {
      this.abortController.clearSession(resolvedSessionID);
    }

    const hooks = Map.groupBy(this.snapshot.entries, (entry) => entry.event).get(event);
    if (!hooks || hooks.length === 0) return;

    const stdinText = this.buildStdinPayload({
      event,
      input,
      output,
      ...(resolvedSessionID && { sessionID: resolvedSessionID }),
    });
    const dependencies = this.createRunDependencies();

    for (const entry of hooks) {
      this.runCounter += 1;
      await executeHookRun({
        dependencies,
        entry,
        event,
        ...(resolvedSessionID && { sessionID: resolvedSessionID }),
        stdinText,
        runId: `${event}#${this.runCounter}`,
        startedAt: Date.now(),
        hookName: path.basename(entry.path, path.extname(entry.path)),
      });
    }
  };

  public createHostEventHandlers = (): Hooks => {
    const handlers = Object.fromEntries(
      PASSTHROUGH_EVENTS.map((event) => [
        event,
        (input?: unknown, output?: Record<string, unknown>) => this.runHook({ event, input, output }),
      ]),
    ) as Hooks;
    const eventSerializer = createEventRunSerializer();

    return {
      ...handlers,
      [HookEvent.Event]: async (input: unknown) => {
        const eventType = eventTypeFrom(input);
        if (eventType && isHostEventName(eventType) && !eventSerializer.has(eventType)) {
          await eventSerializer.run(eventType, async () => {
            await this.runHookReactive({
              event: eventType,
              input,
              crashSource: `reactive_host_event_${eventType}`,
            });
          });
        }
        await eventSerializer.run(HookEvent.Event, async () => {
          await this.runHookReactive({ event: HookEvent.Event, input, crashSource: 'catch_all_event_hook' });
        });
      },
    };
  };

  public snapshot: HookScan;

  constructor(directory: string, options: HooksWrapperOptions = {}) {
    this.snapshot = scanHooks(hooksDirectory(directory));
    this.directory = directory;
    this.statusRecorder = new StatusRecorder({
      directory,
      statusFile: options.statusFile,
      logFile: options.logFile,
    });
    this.abortController = new SessionAbortController(options.endSession);
    this.circuitBreaker = new CircuitBreakerTracker();
    this.activeProcesses = new Set<ReturnType<typeof Bun.spawn>>();
  }
}

export { HooksWrapper };
export default HooksWrapper;
