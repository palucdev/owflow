import { pathToFileURL } from "node:url";
import { parseEnvelopeResult } from "./envelope.js";
import type {
  EnvelopeContext,
  EnvelopeResult,
  HookRegistryEntry,
  Outcome,
} from "./types.js";

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
      let malformedStdout: string | null = null;
      if (stdoutText.trim().length > 0) {
        const parsed = parseEnvelopeResult(stdoutText);
        if (parsed.ok && parsed.data !== undefined)
          return toOutcome(parsed.data);
        // Non-empty stdout that is not a valid result is malformed; a zero exit
        // must never let it pass silently (R4.2, fail closed).
        malformedStdout = parsed.error ?? "unparseable subprocess stdout";
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
      if (malformedStdout !== null) {
        return { status: "failed", reason: malformedStdout };
      }
      return { status: "ok" };
    },
  };
};
