import { HookEvent } from '../../types/hook-types.js';
import { buildCircuitBreakerError, buildInterpreterUnavailableError, buildProcessFailureError, buildSpawnError } from '../runtime/failure-policy.js';
import { HookSpawnError, type HookProcessResult } from '../runtime/process-executor.js';
import { HookRunOperations, type HookRunRequest } from './run-operations.js';

export type { HookRunDependencies, HookRunRequest } from './run-operations.js';

const ensureCircuitClosed = (request: HookRunRequest, ops: HookRunOperations): void => {
  const checkResult = ops.checkCircuit();
  if (!checkResult.tripped) return;

  const reason = checkResult.reason ?? `Circuit breaker active for ${request.entry.path}`;
  ops.recordFailure(reason, request.startedAt);
  throw buildCircuitBreakerError(request.entry.path, reason);
};

const isInterpreterAvailable = (request: HookRunRequest): boolean =>
  request.entry.interpreter.available && Boolean(request.entry.interpreter.resolved);

const rejectUnavailableInterpreter = async (request: HookRunRequest, ops: HookRunOperations): Promise<never> => {
  const { interpreter } = request.entry;
  const label = interpreter.resolved ?? interpreter.expected;
  ops.recordFailure(`${label} is not available`, request.startedAt);
  await ops.abortSession();
  throw buildInterpreterUnavailableError(request.entry.path, label);
};

interface SpawnFailureOptions {
  readonly request: HookRunRequest;
  readonly ops: HookRunOperations;
  readonly spawnError: HookSpawnError;
}

const rethrowSpawnError = async (options: SpawnFailureOptions): Promise<never> => {
  const { request, ops, spawnError } = options;
  const finishedAt = Date.now();
  const spawnErrorMessage = spawnError.originalError instanceof Error ? spawnError.originalError.message : String(spawnError.originalError);
  const reason = `failed to spawn ${request.entry.path}: ${spawnErrorMessage}`;
  ops.recordFailure(reason, finishedAt);
  await ops.abortSession();
  throw buildSpawnError({ scriptPath: request.entry.path, spawnErrorMessage, event: request.event });
};

const spawnHookProcess = async (request: HookRunRequest, ops: HookRunOperations): Promise<HookProcessResult> => {
  ops.recordPending();
  try {
    return await ops.spawn();
  } catch (spawnError) {
    if (!(spawnError instanceof HookSpawnError)) throw spawnError;
    return rethrowSpawnError({ request, ops, spawnError });
  }
};

const isSilentEventSuccess = (request: HookRunRequest, result: HookProcessResult): boolean =>
  result.isOk && request.event === HookEvent.Event && result.rawStdout.trim().length === 0 && result.rawStderr.trim().length === 0;

export const executeHookRun = async (request: HookRunRequest): Promise<void> => {
  const ops = new HookRunOperations(request);
  ensureCircuitClosed(request, ops);
  if (!isInterpreterAvailable(request)) await rejectUnavailableInterpreter(request, ops);

  const previousStatus = ops.previousStatus();
  const result = await spawnHookProcess(request, ops);
  ops.recordCircuitOutcome(result);

  if (isSilentEventSuccess(request, result)) {
    ops.restoreStatus(previousStatus);
    return;
  }

  ops.recordTerminalStatus(result);
  ops.appendTerminalLog(result);
  if (result.isOk) return;

  await ops.abortSession();
  throw buildProcessFailureError({ scriptPath: request.entry.path, reason: result.reason, event: request.event });
};
