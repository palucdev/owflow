/**
 * Hook execution: the `owflow-hooks/1` envelope (build/parse) and the
 * subprocess runner shared by every supported script format.
 */

import type {
  EnvelopeBuildInput,
  EnvelopeContext,
  EnvelopeResult,
  HookCapture,
  HookRunner,
  Outcome,
  ParsedEnvelopeResult,
  SpawnProcess,
  SpawnProcessOptions,
  SpawnedProcess,
  SpawnedStream,
  StreamReader,
  SubprocessRunnerDeps,
} from "../types/hook-types.js";
import { MAX_CAPTURE_BYTES } from "./hook-logs.js";
import { errorMessage } from "./shared.js";

export type {
  EnvelopeBuildInput,
  EnvelopeContext,
  EnvelopeResult,
  HookRunner,
  Outcome,
  ParsedEnvelopeResult,
  SpawnProcess,
  SpawnProcessOptions,
  SpawnedProcess,
  SpawnedStream,
  SubprocessRunnerDeps,
};

/* ── Envelope ─────────────────────────────────────────────────────────────── */

/** The single wire version spoken by every script type and both runners (R4.1). */
export const PROTOCOL_VERSION: EnvelopeContext["protocol"] = "owflow-hooks/1";

/**
 * Identity fields kept when a context value is a host-runtime class instance
 * (`model`/`provider`/`parts`); everything else on such objects is omitted so
 * no instance is ever serialized raw (R4.3).
 */
const CONTEXT_IDENTITY_KEYS: readonly string[] = [
  "id",
  "sessionID",
  "messageID",
  "partID",
  "callID",
  "providerID",
  "type",
  "name",
  "tool",
];

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Projects one object level, keeping only the requested keys. Plain objects
 * pass their own keys; host-runtime class instances pass the identity keys.
 */
const projectObject = (
  source: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> | undefined => {
  const projected: Record<string, unknown> = {};
  for (const key of keys) {
    const item = projectValue(source[key]);
    if (item !== undefined) projected[key] = item;
  }
  return Object.keys(projected).length > 0 ? projected : undefined;
};

const projectValue = (value: unknown): unknown => {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      return Number.isFinite(value) ? value : null;
    case "bigint":
      return value.toString();
    case "object":
      break;
    default:
      return undefined;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => projectValue(item))
      .filter((item) => item !== undefined);
  }
  return projectObject(
    value as Record<string, unknown>,
    isPlainObject(value) ? Object.keys(value) : CONTEXT_IDENTITY_KEYS,
  );
};

/**
 * Builds the wrapper → script envelope. The class is universally "gate"
 * for protocol backward-compatibility; the context is projected to plain JSON data.
 */
export const buildEnvelope = (input: EnvelopeBuildInput): EnvelopeContext => {
  const sessionID = input.sessionID;
  const projected = projectValue(input.context);
  return {
    protocol: PROTOCOL_VERSION,
    event: input.event,
    class: "gate",
    ...(typeof sessionID === "string" && sessionID.length > 0
      ? { session: { sessionID } }
      : {}),
    context: isJsonObject(projected) ? projected : {},
  };
};

const describeType = (value: unknown): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
};


/**
 * Parses a script result from subprocess stdout (object values remain
 * tolerated). Never throws and never logs — every malformed or mismatched
 * result becomes a sentinel (R4.2).
 */
export const parseEnvelopeResult = (raw: unknown): ParsedEnvelopeResult => {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch (error) {
      return {
        ok: false,
        error: `unparseable JSON (${errorMessage(error)})`,
      };
    }
  }
  if (!isJsonObject(value)) {
    return {
      ok: false,
      error: `result is not a JSON object (got ${describeType(value)})`,
    };
  }
  try {
    const protocol = value.protocol;
    if (protocol === undefined) {
      return {
        ok: false,
        error: `missing protocol (expected "${PROTOCOL_VERSION}")`,
      };
    }
    if (protocol !== PROTOCOL_VERSION) {
      return {
        ok: false,
        error: `protocol mismatch (expected "${PROTOCOL_VERSION}", got ${JSON.stringify(protocol)})`,
      };
    }
    const status = value.status;
    if (status !== "ok" && status !== "blocked" && status !== "failed") {
      return {
        ok: false,
        error: `invalid status ${JSON.stringify(status)} (expected "ok", "blocked", or "failed")`,
      };
    }
    const reason = value.reason;
    if (reason !== undefined && typeof reason !== "string") {
      return { ok: false, error: "invalid reason (expected a string)" };
    }
    const mutations = value.mutations;
    if (mutations !== undefined && !isJsonObject(mutations)) {
      return { ok: false, error: "invalid mutations (expected a JSON object)" };
    }
    return {
      ok: true,
      data: {
        protocol: PROTOCOL_VERSION,
        status,
        ...(reason !== undefined ? { reason } : {}),
        ...(mutations !== undefined ? { mutations } : {}),
      },
    };
  } catch (error) {
    return { ok: false, error: `unreadable result (${errorMessage(error)})` };
  }
};

/* ── Runners ──────────────────────────────────────────────────────────────── */


const toOutcome = (result: EnvelopeResult): Outcome => ({
  status: result.status,
  ...(result.reason !== undefined ? { reason: result.reason } : {}),
  ...(result.mutations !== undefined ? { mutations: result.mutations } : {}),
});

interface StreamCapture {
  readonly text: string;
  readonly truncated: boolean;
}

const truncateBytes = (value: string, maxBytes: number): StreamCapture => {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) {
    return { text: value, truncated: false };
  }
  return {
    text: Buffer.from(value, "utf8")
      .subarray(0, Math.max(0, maxBytes))
      .toString("utf8"),
    truncated: true,
  };
};

const readWithReader = async (
  reader: StreamReader,
): Promise<StreamCapture> => {
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      if (size + value.byteLength > MAX_CAPTURE_BYTES) {
        const remaining = MAX_CAPTURE_BYTES - size;
        if (remaining > 0) chunks.push(value.subarray(0, remaining));
        truncated = true;
        try {
          await reader.cancel?.();
        } catch {
          // Cancelling only releases the cap; the partial read is enough.
        }
        break;
      }
      chunks.push(value);
      size += value.byteLength;
    }
  } catch {
    // Keep the chunks read so far; a failed read behaves like a short stream.
  }
  return {
    text: Buffer.concat(chunks).toString("utf8"),
    truncated,
  };
};

const readStream = async (
  stream: SpawnedStream | null | undefined,
): Promise<StreamCapture> => {
  if (stream === null || stream === undefined) {
    return { text: "", truncated: false };
  }
  try {
    if (typeof stream.getReader === "function") {
      return await readWithReader(stream.getReader());
    }
    return truncateBytes(await stream.text(), MAX_CAPTURE_BYTES);
  } catch {
    return { text: "", truncated: false };
  }
};

/**
 * Stdout keeps a small tail beyond the capture cap so a result envelope at the
 * end of a verbose script is still found even when the log prefix is truncated.
 */
const MAX_STDOUT_TAIL_BYTES = 64 * 1024;

interface StdoutRead {
  readonly text: string;
  readonly tail: string;
  readonly truncated: boolean;
}

interface ParsedStdout {
  readonly result?: EnvelopeResult;
  readonly logs?: string;
  readonly error?: string;
}

const readStdoutWithReader = async (
  reader: StreamReader,
): Promise<StdoutRead> => {
  const head: Uint8Array[] = [];
  let headSize = 0;
  const tail: Uint8Array[] = [];
  let tailSize = 0;
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined || value.byteLength === 0) continue;
      total += value.byteLength;
      if (headSize < MAX_CAPTURE_BYTES) {
        const remaining = MAX_CAPTURE_BYTES - headSize;
        const piece =
          value.byteLength <= remaining ? value : value.subarray(0, remaining);
        if (piece.byteLength > 0) {
          head.push(piece);
          headSize += piece.byteLength;
        }
      }
      if (value.byteLength >= MAX_STDOUT_TAIL_BYTES) {
        tail.length = 0;
        tail.push(value.subarray(value.byteLength - MAX_STDOUT_TAIL_BYTES));
        tailSize = MAX_STDOUT_TAIL_BYTES;
      } else {
        tail.push(value);
        tailSize += value.byteLength;
        if (tailSize > MAX_STDOUT_TAIL_BYTES * 2) {
          const recent = Buffer.concat(tail).subarray(-MAX_STDOUT_TAIL_BYTES);
          tail.length = 0;
          tail.push(new Uint8Array(recent));
          tailSize = recent.byteLength;
        }
      }
    }
  } catch {
    // Keep what was read; a failed read behaves like a short stream.
  }
  const tailBytes = Buffer.concat(tail);
  return {
    text: Buffer.concat(head).toString("utf8"),
    tail: tailBytes
      .subarray(Math.max(0, tailBytes.byteLength - MAX_STDOUT_TAIL_BYTES))
      .toString("utf8"),
    truncated: total > MAX_CAPTURE_BYTES,
  };
};

const readStdout = async (
  stream: SpawnedStream | null | undefined,
): Promise<StdoutRead> => {
  if (stream === null || stream === undefined) {
    return { text: "", tail: "", truncated: false };
  }
  try {
    if (typeof stream.getReader === "function") {
      return await readStdoutWithReader(stream.getReader());
    }
    const bytes = Buffer.from(await stream.text(), "utf8");
    return {
      text: bytes.subarray(0, MAX_CAPTURE_BYTES).toString("utf8"),
      tail: bytes
        .subarray(Math.max(0, bytes.byteLength - MAX_STDOUT_TAIL_BYTES))
        .toString("utf8"),
      truncated: bytes.byteLength > MAX_CAPTURE_BYTES,
    };
  } catch {
    return { text: "", tail: "", truncated: false };
  }
};

const isResultObject = (value: unknown): boolean =>
  isJsonObject(value) && ("protocol" in value || "status" in value);

/**
 * The result envelope is either the whole stdout (legacy scripts) or the last
 * object-shaped result line. Any other stdout text is captured as hook output.
 * A line that looks like a result but does not parse still fails closed.
 */
const parseStdout = (stdout: StdoutRead): ParsedStdout => {
  const source = stdout.tail;
  const trimmed = source.trim();
  if (trimmed.length === 0) return {};

  if (!stdout.truncated) {
    const whole = parseEnvelopeResult(trimmed);
    if (whole.ok && whole.data !== undefined) return { result: whole.data };
  }

  const lines = source.split("\n");
  let seenNonEmpty = false;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!.trim();
    if (line.length === 0) continue;
    const isLast = !seenNonEmpty;
    seenNonEmpty = true;

    const parsed = parseEnvelopeResult(line);
    if (parsed.ok && parsed.data !== undefined) {
      return {
        result: parsed.data,
        logs: stdout.truncated
          ? stdout.text
          : lines
              .filter((_, lineIndex) => lineIndex !== index)
              .join("\n"),
      };
    }

    let resultLike = false;
    try {
      resultLike = isResultObject(JSON.parse(line));
    } catch {
      resultLike =
        isLast &&
        line.startsWith("{") &&
        (line.includes('"protocol"') || line.includes('"status"'));
    }
    if (resultLike) {
      return {
        error: parsed.error ?? "unparseable subprocess stdout",
      };
    }
  }

  if (!stdout.truncated) {
    try {
      if (isResultObject(JSON.parse(trimmed))) {
        const whole = parseEnvelopeResult(trimmed);
        return {
          error: whole.error ?? "unparseable subprocess stdout",
        };
      }
    } catch {
      // Plain text (including a broken JSON preamble) is treated as logs.
    }
  }

  return { logs: stdout.truncated ? stdout.text : source };
};

const withStreams = (
  stdout: StreamCapture | undefined,
  stderr: StreamCapture,
  exitCode: number | null,
  signal?: string | null,
): HookCapture => ({
  ...(stdout !== undefined ? { stdout: stdout.text } : {}),
  ...(stderr.text.length > 0 ? { stderr: stderr.text } : {}),
  exitCode,
  ...(signal !== undefined && signal !== null ? { signal } : {}),
  ...(stdout?.truncated === true || stderr.truncated
    ? { truncated: true }
    : {}),
});

const signalReason = (signalCode: string | null | undefined): string =>
  `process terminated by signal ${signalCode ?? "unknown"}`;

export const HOOK_TIMEOUT_ENV = "OWFLOW_HOOK_TIMEOUT_MS";

const resolveTimeoutMs = (configured?: number): number | undefined => {
  if (configured !== undefined) {
    return Number.isFinite(configured) && configured > 0
      ? Math.floor(configured)
      : undefined;
  }
  const raw = process.env[HOOK_TIMEOUT_ENV];
  if (raw === undefined || raw.trim().length === 0) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
};

export const createSubprocessRunner = ({
  cwd,
  spawn,
  timeoutMs,
}: SubprocessRunnerDeps): HookRunner => {
  const spawnProcess: SpawnProcess =
    spawn ?? ((command, options) => Bun.spawn(command, options));
  const activeProcesses = new Set<SpawnedProcess>();

  return {
    run: async (entry, envelope) => {
      const interpreter = entry.interpreter.resolved;
      if (interpreter === undefined || interpreter.length === 0) {
        return {
          status: "failed",
          reason: `no interpreter resolved for ${entry.path}`,
          capture: {},
        };
      }

      // Both streams stay piped: script output is captured into the runtime
      // log and TUI popup, never inherited by the OpenCode process.
      const proc = spawnProcess([interpreter, entry.path], {
        cwd,
        stdin: Buffer.from(JSON.stringify(envelope)),
        stdout: "pipe",
        stderr: "pipe",
      });
      activeProcesses.add(proc);

      const effectiveTimeoutMs = resolveTimeoutMs(timeoutMs);
      let timedOut = false;
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise =
        effectiveTimeoutMs !== undefined
          ? new Promise<"timeout">((resolve) => {
              timeoutTimer = setTimeout(() => {
                timedOut = true;
                try {
                  proc.kill?.();
                } catch {
                  // Ignore errors when killing an already-exited or mock process.
                }
                resolve("timeout");
              }, effectiveTimeoutMs);
              timeoutTimer.unref?.();
            })
          : undefined;

      let ioResult: [StdoutRead, StreamCapture, number | null] | "timeout";
      try {
        const ioPromise = Promise.all([
          readStdout(proc.stdout),
          readStream(proc.stderr),
          proc.exited,
        ]);
        ioResult =
          timeoutPromise !== undefined
            ? await Promise.race([ioPromise, timeoutPromise])
            : await ioPromise;
      } finally {
        if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
        activeProcesses.delete(proc);
      }

      if (ioResult === "timeout" || timedOut) {
        return {
          status: "failed",
          reason: `process timed out after ${effectiveTimeoutMs}ms`,
          capture: {
            exitCode: proc.exitCode ?? null,
            ...(proc.signalCode !== undefined && proc.signalCode !== null
              ? { signal: proc.signalCode }
              : {}),
          },
        };
      }

      const [stdout, stderrStream, awaitedExit] = ioResult;
      const exitCode =
        proc.exitCode === undefined ? awaitedExit : proc.exitCode;
      const parsedStdout = parseStdout(stdout);
      const capturedStdout = (
        text: string | undefined,
      ): StreamCapture | undefined =>
        text !== undefined && text.trim().length > 0
          ? { text, truncated: stdout.truncated }
          : undefined;
      const logs = capturedStdout(
        parsedStdout.result !== undefined
          ? parsedStdout.logs
          : (parsedStdout.logs ?? stdout.text),
      );

      // A parsed JSON status is authoritative over the exit code (R3.3).
      if (parsedStdout.result !== undefined) {
        return {
          ...toOutcome(parsedStdout.result),
          capture: withStreams(logs, stderrStream, exitCode ?? null),
        };
      }

      // A result-looking stdout line that does not parse is malformed; a zero
      // exit must never let it pass silently (R4.2, fail closed).
      if (parsedStdout.error !== undefined && exitCode === 0) {
        return {
          status: "failed",
          reason: parsedStdout.error,
          capture: withStreams(logs, stderrStream, exitCode),
        };
      }

      // `exitCode === null` is a signal kill or an absent code — never success.
      if (exitCode === null || exitCode === undefined) {
        return {
          status: "failed",
          reason: signalReason(proc.signalCode),
          capture: withStreams(
            logs,
            stderrStream,
            exitCode ?? null,
            proc.signalCode ?? null,
          ),
        };
      }
      if (exitCode !== 0) {
        const diagnostics = stderrStream.text.trim();
        return {
          status: "failed",
          reason:
            diagnostics.length > 0
              ? diagnostics
              : `process exited with code ${exitCode}`,
          capture: withStreams(logs, stderrStream, exitCode),
        };
      }
      return {
        status: "ok",
        capture: withStreams(logs, stderrStream, exitCode),
      };
    },
    dispose: () => {
      for (const proc of activeProcesses) {
        try {
          proc.kill?.();
        } catch {
          // Best-effort termination on plugin shutdown.
        }
      }
      activeProcesses.clear();
    },
  };
};
