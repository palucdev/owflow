/**
 * Hook execution: the `owflow-hooks/1` envelope (build/parse), the in-process
 * and subprocess runners, and the combined `{ load, run }` execution core.
 */

import { pathToFileURL } from "node:url";
import { DISPATCHABLE_EVENTS } from "./registry.js";
import type {
  DispatchableEvent,
  EnvelopeContext,
  EnvelopeResult,
  HookRegistryEntry,
  Outcome,
} from "./registry.js";

/* ── Envelope ─────────────────────────────────────────────────────────────── */

/** The single wire version spoken by every script type and both runners (R4.1). */
export const PROTOCOL_VERSION: EnvelopeContext["protocol"] = "owflow-hooks/1";

export interface EnvelopeBuildInput {
  readonly event: DispatchableEvent;
  readonly context: Record<string, unknown>;
  readonly sessionID?: string | undefined;
}

export interface ParsedEnvelopeResult {
  ok: boolean;
  data?: EnvelopeResult;
  error?: string;
}

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
    class: DISPATCHABLE_EVENTS[input.event],
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

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : "unknown error";

/**
 * Parses a script result from either class: stdout JSON for subprocesses or a
 * returned object for in-process handlers. Never throws and never logs — every
 * malformed or mismatched result becomes a sentinel (R4.2).
 */
export const parseEnvelopeResult = (raw: unknown): ParsedEnvelopeResult => {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch (error) {
      return {
        ok: false,
        error: `unparseable JSON (${errorText(error)})`,
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
    return { ok: false, error: `unreadable result (${errorText(error)})` };
  }
};

/* ── Runners ──────────────────────────────────────────────────────────────── */

/** One execution interface for every script class — the v2 seam unit (R11.1). */
export interface HookRunner {
  readonly run: (
    entry: HookRegistryEntry,
    envelope: EnvelopeContext,
  ) => Promise<Outcome>;
}

export type HookHandler = (envelope: EnvelopeContext) => unknown;

/** Injectable dynamic-import seam; the default is the real `import()`. */
export type ModuleImporter = (specifier: string) => Promise<unknown>;

export interface InProcessRunner extends HookRunner {
  /** Imports once and validates the default-export handler (fail-fast, R1.3). */
  readonly load: (entry: HookRegistryEntry) => Promise<void>;
}

export interface SpawnProcessOptions {
  /** Host project directory the script runs in (A5). */
  readonly cwd: string;
  readonly stdin: Uint8Array;
  readonly stdout: "pipe";
  readonly stderr: "pipe";
}

export interface SpawnedStream {
  text(): Promise<string>;
}

/**
 * The slice of a spawned process the runner reads. Deliberately narrower than
 * `Bun.Subprocess` so tests can fake it, and deliberately carries no
 * timeout/signal surface (ADR-007).
 */
export interface SpawnedProcess {
  readonly exited: Promise<number | null>;
  readonly exitCode?: number | null;
  readonly signalCode?: string | null;
  readonly stdout?: SpawnedStream | null;
  readonly stderr?: SpawnedStream | null;
}

/** Injectable `Bun.spawn` seam; argument arrays only, never a shell string. */
export type SpawnProcess = (
  command: string[],
  options: SpawnProcessOptions,
) => SpawnedProcess;

export interface SubprocessRunnerDeps {
  readonly cwd: string;
  readonly spawn?: SpawnProcess;
}

const BLOCKED_PREFIX = "Blocked:";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "unknown error";
};

const toOutcome = (result: EnvelopeResult): Outcome => ({
  status: result.status,
  ...(result.reason !== undefined ? { reason: result.reason } : {}),
  ...(result.mutations !== undefined ? { mutations: result.mutations } : {}),
});

const loadHandler = async (
  importModule: ModuleImporter,
  entry: HookRegistryEntry,
): Promise<HookHandler> => {
  let namespace: unknown;
  try {
    namespace = await importModule(pathToFileURL(entry.path).href);
  } catch (error) {
    // R1.3/R8.1: a failed import must name the offending file and keep the [owflow] prefix.
    throw new Error(`[owflow] ${entry.path}: ${errorMessage(error)}`);
  }
  const handler = isRecord(namespace) ? namespace.default : undefined;
  if (typeof handler !== "function") {
    throw new Error(
      `[owflow] ${entry.path} must default-export a handler function. ` +
        "Hint: add `export default async (envelope) => result` to the hook script, then restart OpenCode.",
    );
  }
  return handler as HookHandler;
};

export const createInProcessRunner = (
  importModule: ModuleImporter = (specifier) => import(specifier),
): InProcessRunner => {
  const handlers = new Map<string, HookHandler>();

  const importOnce = async (entry: HookRegistryEntry): Promise<HookHandler> => {
    const cached = handlers.get(entry.path);
    if (cached !== undefined) return cached;
    const handler = await loadHandler(importModule, entry);
    handlers.set(entry.path, handler);
    return handler;
  };

  return {
    load: async (entry) => {
      await importOnce(entry);
    },
    run: async (entry, envelope) => {
      let handler: HookHandler;
      try {
        handler = await importOnce(entry);
      } catch (error) {
        return { status: "failed", reason: errorMessage(error) };
      }
      try {
        const returned = await handler(envelope);
        // A side-effect-only script returns nothing — same meaning as absent stdout JSON.
        if (returned === undefined) return { status: "ok" };
        const parsed = parseEnvelopeResult(returned);
        if (parsed.ok && parsed.data !== undefined)
          return toOutcome(parsed.data);
        return {
          status: "failed",
          reason: parsed.error ?? "malformed handler result",
        };
      } catch (error) {
        const message = errorMessage(error);
        if (message.startsWith(BLOCKED_PREFIX)) {
          const reason = message.slice(BLOCKED_PREFIX.length).trim();
          return {
            status: "blocked",
            reason: reason.length > 0 ? reason : message,
          };
        }
        return { status: "failed", reason: message };
      }
    },
  };
};

const readStream = async (
  stream: SpawnedStream | null | undefined,
): Promise<string> => {
  if (stream === null || stream === undefined) return "";
  try {
    return await stream.text();
  } catch {
    return "";
  }
};

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
        };
      }

      const proc = spawnProcess([interpreter, entry.path], {
        cwd,
        stdin: Buffer.from(JSON.stringify(envelope)),
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdoutText, stderrText, awaitedExit] = await Promise.all([
        readStream(proc.stdout),
        readStream(proc.stderr),
        proc.exited,
      ]);
      const exitCode =
        proc.exitCode === undefined ? awaitedExit : proc.exitCode;

      // A parsed JSON status is authoritative over the exit code (R3.3).
      if (stdoutText.trim().length > 0) {
        const parsed = parseEnvelopeResult(stdoutText);
        if (parsed.ok && parsed.data !== undefined)
          return toOutcome(parsed.data);
        // Non-empty stdout that is not a valid result is malformed; a zero exit
        // must never let it pass silently (R4.2, fail closed).
        if (exitCode === 0) {
          return {
            status: "failed",
            reason: parsed.error ?? "unparseable subprocess stdout",
          };
        }
      }
      // `exitCode === null` is a signal kill or an absent code — never success.
      if (exitCode === null || exitCode === undefined) {
        return { status: "failed", reason: signalReason(proc.signalCode) };
      }
      if (exitCode !== 0) {
        const diagnostics = stderrText.trim();
        return {
          status: "failed",
          reason:
            diagnostics.length > 0
              ? diagnostics
              : `process exited with code ${exitCode}`,
        };
      }
      return { status: "ok" };
    },
  };
};

/* ── Execution core ───────────────────────────────────────────────────────── */

export interface ExecutionCoreOptions {
  /** Host project directory used as the subprocess `cwd` (A5). */
  readonly cwd: string;
  readonly inProcess?: InProcessRunner;
  readonly subprocess?: HookRunner;
}

/**
 * The v2 seam: `run(entry, envelope) → Outcome` over both runner classes
 * (R11.1). `load` is registration-time import validation, deliberately kept
 * off the `run` path so the seam signature stays exactly `(entry, envelope)`.
 */
export interface ExecutionCore extends HookRunner {
  readonly load: (entries: readonly HookRegistryEntry[]) => Promise<void>;
}

export const createExecutionCore = (
  options: ExecutionCoreOptions,
): ExecutionCore => {
  const inProcess = options.inProcess ?? createInProcessRunner();
  const subprocess =
    options.subprocess ?? createSubprocessRunner({ cwd: options.cwd });

  return {
    load: async (entries) => {
      for (const entry of entries) {
        if (entry.runnerClass === "in-process") await inProcess.load(entry);
      }
    },
    run: (entry: HookRegistryEntry, envelope: EnvelopeContext) =>
      entry.runnerClass === "in-process"
        ? inProcess.run(entry, envelope)
        : subprocess.run(entry, envelope),
  };
};
