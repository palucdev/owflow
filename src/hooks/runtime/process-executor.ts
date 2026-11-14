import type { HookEventName, HookRegistryEntry } from '../../types/hook-types.js';
import { createDefaultEnvironmentConfig, type EnvironmentConfig } from '../../utils/environment-config.js';
import { readStream } from './stream-reader.js';

export { MAX_STREAM_BUFFER_BYTES, readStream, type ReadStreamOptions } from './stream-reader.js';

export const DEFAULT_HOOK_TIMEOUT_MS = 120_000;
export const HOOK_TIMEOUT_ENV = 'OWFLOW_HOOK_TIMEOUT_MS';

export class HookSpawnError extends Error {
  constructor(readonly originalError: unknown) {
    super(originalError instanceof Error ? originalError.message : String(originalError));
    this.name = 'HookSpawnError';
  }
}

export const buildExecutionArguments = (entry: HookRegistryEntry): string[] => {
  const resolvedLower = (entry.interpreter.resolved ?? '').toLowerCase();
  const isPowerShell =
    entry.path.endsWith('.ps1') ||
    entry.interpreter.expected === 'pwsh' ||
    resolvedLower.includes('powershell') ||
    resolvedLower.includes('pwsh');

  return isPowerShell
    ? [entry.interpreter.resolved!, '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', entry.path]
    : [entry.interpreter.resolved!, entry.path];
};

export { buildExecutionArguments as buildExecutionArgs };

export const resolveHookTimeoutMs = (
  config: EnvironmentConfig = createDefaultEnvironmentConfig(),
): number =>
  config.hookTimeoutMs === undefined ? DEFAULT_HOOK_TIMEOUT_MS : Math.max(0, config.hookTimeoutMs);

export interface ExecuteHookProcessOptions {
  entry: HookRegistryEntry;
  directory: string;
  stdinText: string;
  event: HookEventName;
  startedAt?: number;
  timeoutMs?: number;
  activeProcs?: Set<ReturnType<typeof Bun.spawn>>;
  config?: EnvironmentConfig;
}

export interface HookProcessResult {
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  isOk: boolean;
  ok: boolean;
  isTimedOut: boolean;
  timedOut: boolean;
  exitCode: number | null;
  signal: string | null;
  rawStdout: string;
  rawStderr: string;
  reason?: string;
}

interface ProcessRunResult {
  readonly rawStdout: string;
  readonly rawStderr: string;
  readonly exitCode: number | undefined;
  readonly isTimedOut: boolean;
}

const createProcessIoPromise = (proc: ReturnType<typeof Bun.spawn>) =>
  Promise.all([
    readStream(proc.stdout as ReadableStream<Uint8Array> | null | undefined),
    readStream(proc.stderr as ReadableStream<Uint8Array> | null | undefined),
    proc.exited,
  ]);

const createTimeoutPromise = (
  proc: ReturnType<typeof Bun.spawn>,
  timeoutMs: number,
): { timeoutPromise: Promise<'timeout'>; timer: ReturnType<typeof setTimeout> } => {
  let timer!: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // ignore kill error
      }
      resolve('timeout');
    }, Math.floor(timeoutMs));
    timer.unref?.();
  });
  return { timeoutPromise, timer };
};

const waitForProcess = async (
  proc: ReturnType<typeof Bun.spawn>,
  timeoutMs: number,
): Promise<ProcessRunResult> => {
  const ioPromise = createProcessIoPromise(proc);
  if (timeoutMs <= 0) {
    const [rawStdout, rawStderr, code] = await ioPromise;
    return { rawStdout, rawStderr, exitCode: code ?? undefined, isTimedOut: false };
  }

  const { timeoutPromise, timer } = createTimeoutPromise(proc, timeoutMs);

  try {
    const outcome = await Promise.race([ioPromise, timeoutPromise]);
    if (outcome === 'timeout') {
      return { rawStdout: '', rawStderr: '', exitCode: undefined, isTimedOut: true };
    }
    const [rawStdout, rawStderr, code] = outcome;
    return { rawStdout, rawStderr, exitCode: code ?? undefined, isTimedOut: false };
  } finally {
    clearTimeout(timer);
  }
};

interface FailureReasonOptions {
  readonly isOk: boolean;
  readonly isTimedOut: boolean;
  readonly timeoutMs: number;
  readonly rawStderr: string;
  readonly rawStdout: string;
  readonly signal: string | undefined;
  readonly exitCode: number | undefined;
}

const buildFailureReason = (options: FailureReasonOptions): string | undefined => {
  if (options.isOk) {
    return undefined;
  }
  if (options.isTimedOut) {
    return `process timed out after ${Math.floor(options.timeoutMs)}ms`;
  }
  const trimmedStderr = options.rawStderr.trim();
  if (trimmedStderr) {
    return trimmedStderr;
  }
  const trimmedStdout = options.rawStdout.trim();
  if (trimmedStdout) {
    return trimmedStdout;
  }
  if (options.signal) {
    return `process terminated by signal ${options.signal}`;
  }
  return `process exited with code ${options.exitCode ?? 'unknown'}`;
};

interface SpawnOptions {
  readonly entry: HookRegistryEntry;
  readonly directory: string;
  readonly stdinText: string;
}

const spawnHookProcess = (
  options: SpawnOptions,
): ReturnType<typeof Bun.spawn> => {
  try {
    return Bun.spawn(buildExecutionArguments(options.entry), {
      cwd: options.directory,
      stdin: Buffer.from(options.stdinText),
      stdout: 'pipe',
      stderr: 'pipe',
    });
  } catch (spawnError) {
    throw new HookSpawnError(spawnError);
  }
};

interface FormatResultOptions {
  readonly startedAt: number;
  readonly runResult: ProcessRunResult;
  readonly signal: string | undefined;
  readonly timeoutMs: number;
}

const formatProcessResult = (options: FormatResultOptions): HookProcessResult => {
  const finishedAt = Date.now();
  const durationMs = Math.max(0, finishedAt - options.startedAt);
  const isOk = !options.runResult.isTimedOut && options.runResult.exitCode === 0 && options.signal === undefined;
  const reason = buildFailureReason({
    isOk,
    isTimedOut: options.runResult.isTimedOut,
    timeoutMs: options.timeoutMs,
    rawStderr: options.runResult.rawStderr,
    rawStdout: options.runResult.rawStdout,
    signal: options.signal,
    exitCode: options.runResult.exitCode,
  });
  return {
    startedAt: options.startedAt,
    finishedAt,
    durationMs,
    isOk,
    ok: isOk,
    isTimedOut: options.runResult.isTimedOut,
    timedOut: options.runResult.isTimedOut,
    exitCode: options.runResult.exitCode ?? (JSON.parse('null') as null),
    signal: options.signal ?? (JSON.parse('null') as null),
    rawStdout: options.runResult.rawStdout,
    rawStderr: options.runResult.rawStderr,
    reason,
  };
};

export const executeHookProcess = async (
  options: ExecuteHookProcessOptions,
): Promise<HookProcessResult> => {
  const config = options.config ?? createDefaultEnvironmentConfig();
  const {
    entry,
    directory,
    stdinText,
    event,
    startedAt = Date.now(),
    timeoutMs = resolveHookTimeoutMs(config),
    activeProcs,
  } = options;

  if (config.isDebugEnabled) {
    console.error(`[owflow:debug] [${event}] Spawning ${entry.path} (stdin: ${stdinText.length} bytes)`);
  }

  const proc = spawnHookProcess({ entry, directory, stdinText });
  activeProcs?.add(proc);

  let runResult: ProcessRunResult;
  try {
    runResult = await waitForProcess(proc, timeoutMs);
  } finally {
    activeProcs?.delete(proc);
  }

  const signal = proc.signalCode ?? undefined;
  const result = formatProcessResult({ startedAt, runResult, signal, timeoutMs });

  if (config.isDebugEnabled) {
    console.error(
      `[owflow:debug] [${event}] Finished ${entry.path} in ${result.durationMs}ms (exitCode: ${runResult.exitCode}, ok: ${result.isOk})`,
    );
  }

  return result;
};
