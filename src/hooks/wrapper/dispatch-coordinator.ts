import {
  HookEvent,
  HookRunState,
  type HookEventName,
  type HookRegistryEntry,
  type HookRuntimeEntry,
} from '../../types/hook-types.js';
import type { CircuitBreakerTracker } from '../runtime/circuit-breaker.js';
import {
  type SessionAbortController,
  buildCircuitBreakerError,
  buildInterpreterUnavailableError,
  buildProcessFailureError,
  buildSpawnError,
} from '../runtime/failure-policy.js';
import { HookSpawnError, executeHookProcess, type HookProcessResult } from '../runtime/process-executor.js';
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

interface RunLogOptions {
  readonly request: HookRunRequest;
  readonly status: HookRunState;
  readonly finishedAt: number;
  readonly durationMs: number;
  readonly exitCode?: number | null;
  readonly signal?: string | null;
  readonly reason?: string;
  readonly stdout?: string;
  readonly stderr?: string;
}

const appendRunLog = (options: RunLogOptions): void => {
  const { request } = options;
  request.dependencies.statusRecorder.appendLog({
    version: 1,
    runId: request.runId,
    pid: process.pid,
    workspace: request.dependencies.workspace,
    event: request.event,
    hook: request.entry.path,
    name: request.hookName,
    ...(request.sessionID && { sessionID: request.sessionID }),
    startedAt: request.startedAt,
    finishedAt: options.finishedAt,
    durationMs: options.durationMs,
    status: options.status,
    ...(options.exitCode !== undefined && { exitCode: options.exitCode }),
    ...(options.signal && { signal: options.signal }),
    ...(options.reason && { reason: options.reason }),
    ...(options.stdout && { stdout: options.stdout }),
    ...(options.stderr && { stderr: options.stderr }),
  });
};

interface FailureRecordOptions {
  readonly request: HookRunRequest;
  readonly reason: string;
  readonly finishedAt: number;
}

const recordFailure = (options: FailureRecordOptions): void => {
  const { request } = options;
  request.dependencies.statusRecorder.setStatus(
    request.event,
    buildStatusEntry({
      status: HookRunState.FAILURE,
      startedAt: request.startedAt,
      finishedAt: options.finishedAt,
      durationMs: 0,
      reason: options.reason,
      ...(request.sessionID && { sessionID: request.sessionID }),
    }),
  );
  request.dependencies.statusRecorder.flushStatus();
  appendRunLog({ request, status: HookRunState.FAILURE, finishedAt: options.finishedAt, durationMs: 0, reason: options.reason });
};

const abortSession = async (request: HookRunRequest): Promise<void> =>
  request.dependencies.abortController.abortSession({
    event: request.event,
    sessionID: request.sessionID,
    scriptPath: request.entry.path,
  });

const ensureCircuitClosed = (request: HookRunRequest): void => {
  const checkResult = request.dependencies.circuitBreaker.check({
    event: request.event,
    scriptPath: request.entry.path,
    sessionID: request.sessionID,
    now: request.startedAt,
  });
  if (!checkResult.tripped) return;

  const reason = checkResult.reason ?? `Circuit breaker active for ${request.entry.path}`;
  recordFailure({ request, reason, finishedAt: request.startedAt });
  throw buildCircuitBreakerError(request.entry.path, reason);
};

const isInterpreterAvailable = (request: HookRunRequest): boolean =>
  request.entry.interpreter.available && Boolean(request.entry.interpreter.resolved);

const rejectUnavailableInterpreter = async (request: HookRunRequest): Promise<never> => {
  const { interpreter } = request.entry;
  const label = interpreter.resolved ?? interpreter.expected;
  const reason = `${label} is not available`;
  recordFailure({ request, reason, finishedAt: request.startedAt });
  await abortSession(request);
  throw buildInterpreterUnavailableError(request.entry.path, label);
};

const rethrowSpawnError = async (request: HookRunRequest, spawnError: HookSpawnError): Promise<never> => {
  const finishedAt = Date.now();
  const spawnErrorMessage =
    spawnError.originalError instanceof Error ? spawnError.originalError.message : String(spawnError.originalError);
  const reason = `failed to spawn ${request.entry.path}: ${spawnErrorMessage}`;
  recordFailure({ request, reason, finishedAt });
  await abortSession(request);
  throw buildSpawnError({ scriptPath: request.entry.path, spawnErrorMessage, event: request.event });
};

const runHookProcess = async (request: HookRunRequest): Promise<HookProcessResult> => {
  const { statusRecorder } = request.dependencies;
  statusRecorder.setStatus(
    request.event,
    buildStatusEntry({
      status: HookRunState.PENDING,
      startedAt: request.startedAt,
      ...(request.sessionID && { sessionID: request.sessionID }),
    }),
  );
  statusRecorder.schedulePendingStatus();

  try {
    return await executeHookProcess({
      entry: request.entry,
      directory: request.dependencies.workspace,
      stdinText: request.stdinText,
      event: request.event,
      startedAt: request.startedAt,
      activeProcs: request.dependencies.activeProcesses,
    });
  } catch (spawnError) {
    if (!(spawnError instanceof HookSpawnError)) throw spawnError;
    return rethrowSpawnError(request, spawnError);
  }
};

const updateCircuitBreaker = (request: HookRunRequest, result: HookProcessResult): void => {
  if (result.isOk) {
    request.dependencies.circuitBreaker.recordSuccess({
      event: request.event,
      scriptPath: request.entry.path,
      sessionID: request.sessionID,
    });
    return;
  }
  request.dependencies.circuitBreaker.recordFailure({
    event: request.event,
    scriptPath: request.entry.path,
    sessionID: request.sessionID,
    startedAt: request.startedAt,
    finishedAt: result.finishedAt,
  });
};

const isSilentEventSuccess = (request: HookRunRequest, result: HookProcessResult): boolean =>
  result.isOk &&
  request.event === HookEvent.Event &&
  result.rawStdout.trim().length === 0 &&
  result.rawStderr.trim().length === 0;

const restorePreviousStatus = (request: HookRunRequest, previousStatus: HookRuntimeEntry | undefined): void => {
  const { statusRecorder } = request.dependencies;
  if (previousStatus) {
    statusRecorder.setStatus(request.event, previousStatus);
  } else {
    statusRecorder.deleteStatus(request.event);
  }
  statusRecorder.flushStatus();
};

const recordTerminalStatus = (request: HookRunRequest, result: HookProcessResult): void => {
  const { statusRecorder } = request.dependencies;
  statusRecorder.setStatus(
    request.event,
    buildStatusEntry({
      status: result.isOk ? HookRunState.SUCCESS : HookRunState.FAILURE,
      startedAt: request.startedAt,
      finishedAt: result.finishedAt,
      durationMs: result.durationMs,
      ...(result.reason && { reason: result.reason }),
      ...(request.sessionID && { sessionID: request.sessionID }),
    }),
  );
  statusRecorder.flushStatus();
};

const capStream = (streamText: string, sessionID: string | undefined): string =>
  sessionID || streamText.length <= NON_SESSION_STREAM_CAP_BYTES ? streamText : streamText.slice(0, NON_SESSION_STREAM_CAP_BYTES);

const appendTerminalLog = (request: HookRunRequest, result: HookProcessResult): void => {
  appendRunLog({
    request,
    status: result.isOk ? HookRunState.SUCCESS : HookRunState.FAILURE,
    finishedAt: result.finishedAt,
    durationMs: result.durationMs,
    exitCode: result.exitCode,
    signal: result.signal,
    ...(result.reason && { reason: result.reason }),
    stdout: capStream(result.rawStdout, request.sessionID),
    stderr: capStream(result.rawStderr, request.sessionID),
  });
};

export const executeHookRun = async (request: HookRunRequest): Promise<void> => {
  ensureCircuitClosed(request);
  if (!isInterpreterAvailable(request)) await rejectUnavailableInterpreter(request);

  const previousStatus = request.dependencies.statusRecorder.getStatus(request.event);
  const result = await runHookProcess(request);
  updateCircuitBreaker(request, result);

  if (isSilentEventSuccess(request, result)) {
    restorePreviousStatus(request, previousStatus);
    return;
  }

  recordTerminalStatus(request, result);
  appendTerminalLog(request, result);
  if (result.isOk) return;

  await abortSession(request);
  throw buildProcessFailureError({ scriptPath: request.entry.path, reason: result.reason, event: request.event });
};
