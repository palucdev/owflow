/**
 * Hook execution: the `owflow-hooks/1` envelope (build/parse) and the
 * subprocess runner shared by every supported script format.
 */

import { hookClassOf } from "../types/hook-types.js";
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
 * Builds the wrapper → script envelope. The class is derived from the shared
 * event table so envelope and registry can never disagree (R6.1); the context
 * is projected to plain JSON data (R4.3).
 */
export const buildEnvelope = (input: EnvelopeBuildInput): EnvelopeContext => {
  const sessionID = input.sessionID;
  const projected = projectValue(input.context);
  return {
    protocol: PROTOCOL_VERSION,
    event: input.event,
    class: hookClassOf(input.event),
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

export const createSubprocessRunner = ({
  cwd,
  spawn,
}: SubprocessRunnerDeps): HookRunner => {
  const spawnProcess: SpawnProcess =
    spawn ?? ((command, options) => Bun.spawn(command, options));

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

      const proc = spawnProcess([interpreter, entry.path], {
        cwd,
        stdin: Buffer.from(JSON.stringify(envelope)),
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdoutStream, stderrStream, awaitedExit] = await Promise.all([
        readStream(proc.stdout),
        readStream(proc.stderr),
        proc.exited,
      ]);
      const exitCode =
        proc.exitCode === undefined ? awaitedExit : proc.exitCode;
      let malformedStdout: StreamCapture | undefined;

      // A parsed JSON status is authoritative over the exit code (R3.3).
      if (stdoutStream.text.trim().length > 0) {
        const parsed = parseEnvelopeResult(stdoutStream.text);
        if (parsed.ok && parsed.data !== undefined) {
          return {
            ...toOutcome(parsed.data),
            capture: withStreams(undefined, stderrStream, exitCode ?? null),
          };
        }
        malformedStdout = stdoutStream;
        // Non-empty stdout that is not a valid result is malformed; a zero exit
        // must never let it pass silently (R4.2, fail closed).
        if (exitCode === 0) {
          return {
            status: "failed",
            reason: parsed.error ?? "unparseable subprocess stdout",
            capture: withStreams(
              malformedStdout,
              stderrStream,
              exitCode,
            ),
          };
        }
      }
      // `exitCode === null` is a signal kill or an absent code — never success.
      if (exitCode === null || exitCode === undefined) {
        return {
          status: "failed",
          reason: signalReason(proc.signalCode),
          capture: withStreams(
            malformedStdout,
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
          capture: withStreams(malformedStdout, stderrStream, exitCode),
        };
      }
      return {
        status: "ok",
        capture: withStreams(malformedStdout, stderrStream, exitCode),
      };
    },
  };
};
