import type { HookEventName, HookRegistryEntry } from '../../types/hook-types.js';

export const DEFAULT_HOOK_TIMEOUT_MS = 120_000;
export const HOOK_TIMEOUT_ENV = 'OWFLOW_HOOK_TIMEOUT_MS';
export const MAX_STREAM_BUFFER_BYTES = 4 * 1024 * 1024;

export class HookSpawnError extends Error {
  constructor(readonly originalError: unknown) {
    super(originalError instanceof Error ? originalError.message : String(originalError));
    this.name = 'HookSpawnError';
  }
}

export const buildExecutionArgs = (entry: HookRegistryEntry): string[] => {
  const resolvedLower = (entry.interpreter.resolved ?? '').toLowerCase();
  const isPowerShell =
    entry.path.endsWith('.ps1') || entry.interpreter.expected === 'pwsh' || resolvedLower.includes('powershell') || resolvedLower.includes('pwsh');

  if (isPowerShell) {
    return [entry.interpreter.resolved!, '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', entry.path];
  }

  return [entry.interpreter.resolved!, entry.path];
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

export const resolveHookTimeoutMs = (): number => {
  const rawTimeout = process.env[HOOK_TIMEOUT_ENV];
  if (rawTimeout === undefined) return DEFAULT_HOOK_TIMEOUT_MS;
  const parsed = Number(rawTimeout);
  if (Number.isFinite(parsed) && parsed <= 0) return 0;
  if (Number.isFinite(parsed)) return parsed;
  return DEFAULT_HOOK_TIMEOUT_MS;
};

export interface ExecuteHookProcessOptions {
  entry: HookRegistryEntry;
  directory: string;
  stdinText: string;
  event: HookEventName;
  startedAt?: number;
  timeoutMs?: number;
  activeProcs?: Set<ReturnType<typeof Bun.spawn>>;
}

export interface HookProcessResult {
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  ok: boolean;
  timedOut: boolean;
  exitCode: number | null;
  signal: string | null;
  rawStdout: string;
  rawStderr: string;
  reason?: string;
}

export const executeHookProcess = async (options: ExecuteHookProcessOptions): Promise<HookProcessResult> => {
  const { entry, directory, stdinText, event, startedAt = Date.now(), timeoutMs = resolveHookTimeoutMs(), activeProcs } = options;

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
    activeProcs?.add(proc);
  } catch (spawnError) {
    throw new HookSpawnError(spawnError);
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
    activeProcs?.delete(proc);
  }

  const finishedAt = Date.now();
  const durationMs = Math.max(0, finishedAt - startedAt);
  const signal = proc.signalCode ?? null;
  const ok = !timedOut && exitCode === 0 && signal === null;

  if (process.env.OWFLOW_DEBUG === '1') {
    console.error(`[owflow:debug] [${event}] Finished ${entry.path} in ${durationMs}ms (exitCode: ${exitCode}, ok: ${ok})`);
  }

  const reason = ok
    ? undefined
    : timedOut
      ? `process timed out after ${Math.floor(timeoutMs)}ms`
      : rawStderr.trim() || rawStdout.trim() || (signal ? `process terminated by signal ${signal}` : `process exited with code ${exitCode}`);

  return {
    startedAt,
    finishedAt,
    durationMs,
    ok,
    timedOut,
    exitCode,
    signal,
    rawStdout,
    rawStderr,
    reason,
  };
};
