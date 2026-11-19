import {
  HookRunState,
  type HookEventName,
  type HookRegistryEntry,
  type HookRuntimeEntry,
} from '../../types/hook-types.js';
import type { CircuitBreakerCheckResult, CircuitBreakerTracker } from '../runtime/circuit-breaker.js';
import type { SessionAbortController } from '../runtime/failure-policy.js';
import { executeHookProcess, type HookProcessResult } from '../runtime/process-executor.js';
import { NON_SESSION_STREAM_CAP_BYTES, type StatusRecorder } from '../runtime/status-recorder.js';

export interface HookRunDependencies {
  readonly statusRecorder: StatusRecorder;
  readonly abortController: SessionAbortController;
  readonly circuitBreaker: CircuitBreakerTracker;
  readonly activeProcesses: Set<ReturnType<typeof Bun.spawn>>;
  readonly workspace: string;
}

export interface HookRunRequest {
  readonly dependencies: HookRunDependencies;
  readonly entry: HookRegistryEntry;
  readonly event: HookEventName;
  readonly sessionID?: string;
  readonly stdinText: string;
  readonly runId: string;
  readonly startedAt: number;
  readonly hookName: string;
}

interface StatusEntryOptions {
  readonly status: HookRunState;
  readonly startedAt: number;
  readonly sessionID?: string;
  readonly finishedAt?: number;
  readonly durationMs?: number;
  readonly reason?: string;
}

const buildStatusEntry = (options: StatusEntryOptions): HookRuntimeEntry => ({
  status: options.status,
  startedAt: options.startedAt,
  ...(options.finishedAt !== undefined && { finishedAt: options.finishedAt }),
  ...(options.durationMs !== undefined && { durationMs: options.durationMs }),
  ...(options.reason && { reason: options.reason }),
  ...(options.sessionID && { sessionID: options.sessionID }),
});

interface RunLogDelta {
  readonly status: HookRunState;
  readonly finishedAt: number;
  readonly durationMs: number;
  readonly exitCode?: number | null;
  readonly signal?: string | null;
  readonly reason?: string;
  readonly stdout?: string;
  readonly stderr?: string;
}

const capStream = (streamText: string, sessionID: string | undefined): string =>
  sessionID || streamText.length <= NON_SESSION_STREAM_CAP_BYTES ? streamText : streamText.slice(0, NON_SESSION_STREAM_CAP_BYTES);

// Binds a run's collaborators and invariants once so the executor orchestrates
// through intent methods instead of reaching through request.dependencies.
export class HookRunOperations {
  private readonly recorder: StatusRecorder;
  private readonly breaker: CircuitBreakerTracker;
  private readonly aborter: SessionAbortController;
  private readonly activeProcs: Set<ReturnType<typeof Bun.spawn>>;
  private readonly workspace: string;
  private readonly event: HookEventName;
  private readonly scriptPath: string;
  private readonly sessionID?: string;
  private readonly startedAt: number;

  constructor(private readonly request: HookRunRequest) {
    const { statusRecorder, abortController, circuitBreaker, activeProcesses, workspace } = request.dependencies;
    this.recorder = statusRecorder;
    this.aborter = abortController;
    this.breaker = circuitBreaker;
    this.activeProcs = activeProcesses;
    this.workspace = workspace;
    this.event = request.event;
    this.scriptPath = request.entry.path;
    this.sessionID = request.sessionID;
    this.startedAt = request.startedAt;
  }

  private appendLog(delta: RunLogDelta): void {
    this.recorder.appendLog({
      version: 1,
      runId: this.request.runId,
      pid: process.pid,
      workspace: this.workspace,
      event: this.event,
      hook: this.scriptPath,
      name: this.request.hookName,
      ...(this.sessionID && { sessionID: this.sessionID }),
      startedAt: this.startedAt,
      finishedAt: delta.finishedAt,
      durationMs: delta.durationMs,
      status: delta.status,
      ...(delta.exitCode !== undefined && { exitCode: delta.exitCode }),
      ...(delta.signal && { signal: delta.signal }),
      ...(delta.reason && { reason: delta.reason }),
      ...(delta.stdout && { stdout: delta.stdout }),
      ...(delta.stderr && { stderr: delta.stderr }),
    });
  }

  checkCircuit(): CircuitBreakerCheckResult {
    return this.breaker.check({
      event: this.event,
      scriptPath: this.scriptPath,
      sessionID: this.sessionID,
      now: this.startedAt,
    });
  }

  recordFailure(reason: string, finishedAt: number): void {
    this.recorder.setStatus(
      this.event,
      buildStatusEntry({
        status: HookRunState.FAILURE,
        startedAt: this.startedAt,
        finishedAt,
        durationMs: 0,
        reason,
        ...(this.sessionID && { sessionID: this.sessionID }),
      }),
    );
    this.recorder.flushStatus();
    this.appendLog({ status: HookRunState.FAILURE, finishedAt, durationMs: 0, reason });
  }

  recordPending(): void {
    this.recorder.setStatus(
      this.event,
      buildStatusEntry({
        status: HookRunState.PENDING,
        startedAt: this.startedAt,
        ...(this.sessionID && { sessionID: this.sessionID }),
      }),
    );
    this.recorder.schedulePendingStatus();
  }

  async spawn(): Promise<HookProcessResult> {
    return executeHookProcess({
      entry: this.request.entry,
      directory: this.workspace,
      stdinText: this.request.stdinText,
      event: this.event,
      startedAt: this.startedAt,
      activeProcs: this.activeProcs,
    });
  }

  recordCircuitOutcome(result: HookProcessResult): void {
    const invocation = {
      event: this.event,
      scriptPath: this.scriptPath,
      sessionID: this.sessionID,
    };
    if (result.isOk) {
      this.breaker.recordSuccess(invocation);
      return;
    }
    this.breaker.recordFailure({ ...invocation, startedAt: this.startedAt, finishedAt: result.finishedAt });
  }

  previousStatus(): HookRuntimeEntry | undefined {
    return this.recorder.getStatus(this.event);
  }

  restoreStatus(previous: HookRuntimeEntry | undefined): void {
    if (previous) {
      this.recorder.setStatus(this.event, previous);
    } else {
      this.recorder.deleteStatus(this.event);
    }
    this.recorder.flushStatus();
  }

  recordTerminalStatus(result: HookProcessResult): void {
    this.recorder.setStatus(
      this.event,
      buildStatusEntry({
        status: result.isOk ? HookRunState.SUCCESS : HookRunState.FAILURE,
        startedAt: this.startedAt,
        finishedAt: result.finishedAt,
        durationMs: result.durationMs,
        ...(result.reason && { reason: result.reason }),
        ...(this.sessionID && { sessionID: this.sessionID }),
      }),
    );
    this.recorder.flushStatus();
  }

  appendTerminalLog(result: HookProcessResult): void {
    this.appendLog({
      status: result.isOk ? HookRunState.SUCCESS : HookRunState.FAILURE,
      finishedAt: result.finishedAt,
      durationMs: result.durationMs,
      exitCode: result.exitCode,
      signal: result.signal,
      ...(result.reason && { reason: result.reason }),
      stdout: capStream(result.rawStdout, this.sessionID),
      stderr: capStream(result.rawStderr, this.sessionID),
    });
  }

  async abortSession(): Promise<void> {
    await this.aborter.abortSession({
      event: this.event,
      sessionID: this.sessionID,
      scriptPath: this.scriptPath,
    });
  }
}
