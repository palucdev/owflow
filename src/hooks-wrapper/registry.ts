/**
 * Hook registry: shared vocabulary, naming/extension tables, interpreter
 * resolution, strict directory digest, and the unified `scanHooks` scan.
 *
 * Every module under `src/hooks-wrapper/` stays platform-agnostic by contract
 * (R11.1): no host-framework imports or identifiers anywhere in these modules.
 */

import fs from "node:fs";
import type { Dirent } from "node:fs";
import path from "node:path";

/* ── Shared vocabulary ────────────────────────────────────────────────────── */

export type HookClass = "gate" | "observe";

export type RunnerClass = "in-process" | "subprocess";

export type HookExtension = ".ts" | ".js" | ".sh" | ".ps1";

export type DispatchableEvent =
  | "tool.execute.before"
  | "tool.execute.after"
  | "tool.definition"
  | "chat.message"
  | "chat.params"
  | "chat.headers"
  | "command.execute.before"
  | "shell.env"
  | "experimental.chat.messages.transform"
  | "experimental.chat.system.transform"
  | "experimental.session.compacting"
  | "experimental.compaction.autocontinue"
  | "experimental.text.complete"
  | "config"
  | "event"
  | "dispose";

export type HookEntryStatus =
  | "registered"
  | "will-fail-closed"
  | "skipped-no-interpreter";

export interface InterpreterResolution {
  readonly resolved?: string;
  /** First candidate name, recorded when nothing resolved (R2.2 report labels). */
  readonly expected?: string;
  readonly available: boolean;
}

export type InterpreterAvailability = Readonly<
  Record<HookExtension, InterpreterResolution>
>;

export interface HookScript {
  readonly path: string;
  readonly stem: string;
  readonly event: DispatchableEvent;
  readonly class: HookClass;
  readonly runnerClass: RunnerClass;
  readonly extension: HookExtension;
}

export interface HookValidationFailure {
  readonly path: string;
  readonly error: string;
}

export type HookDigestMode = "throw" | "report";

export interface HookDigest {
  readonly entries: readonly HookScript[];
  readonly failures: readonly HookValidationFailure[];
}

export interface HookRegistryEntry {
  readonly path: string;
  readonly event: DispatchableEvent;
  readonly class: HookClass;
  readonly runnerClass: RunnerClass;
  readonly interpreter: InterpreterResolution;
  readonly status: HookEntryStatus;
}

export interface HookRegistry {
  readonly entries: readonly HookRegistryEntry[];
  readonly byEvent: Readonly<
    Record<DispatchableEvent, readonly HookRegistryEntry[]>
  >;
}

export type OutcomeStatus = "ok" | "blocked" | "failed";

export interface Outcome {
  readonly status: OutcomeStatus;
  readonly reason?: string;
  readonly mutations?: Record<string, unknown>;
}

export interface EnvelopeContext {
  readonly protocol: "owflow-hooks/1";
  readonly event: DispatchableEvent;
  readonly class: HookClass;
  readonly session?: { readonly sessionID: string };
  readonly context: Record<string, unknown>;
}

export interface EnvelopeResult {
  readonly protocol: "owflow-hooks/1";
  readonly status: OutcomeStatus;
  readonly reason?: string;
  readonly mutations?: Record<string, unknown>;
}

/* ── Naming, extensions, and the event table ──────────────────────────────── */

/** Stems accepted by the digest: `[a-z0-9]+(-[a-z0-9]+)*`. */
export const HOOK_STEM_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const HOOK_EXTENSIONS: readonly HookExtension[] = [
  ".ts",
  ".js",
  ".sh",
  ".ps1",
];

/** Fixed rank decides same-stem collisions; both entries register and run in rank order (A4). */
export const EXTENSION_RANK: Readonly<Record<HookExtension, number>> = {
  ".ts": 0,
  ".js": 1,
  ".sh": 2,
  ".ps1": 3,
};

export const isHookExtension = (value: string): value is HookExtension =>
  (HOOK_EXTENSIONS as readonly string[]).includes(value);

export const runnerClassForExtension = (
  extension: HookExtension,
): RunnerClass =>
  extension === ".sh" || extension === ".ps1" ? "subprocess" : "in-process";

export const toDottedEvent = (stem: string): string =>
  stem.split("-").join(".");

/** The one event table shared by every surface, so classes agree by construction (R6.1). */
export const DISPATCHABLE_EVENTS: Readonly<
  Record<DispatchableEvent, HookClass>
> = {
  "tool.execute.before": "gate",
  "tool.execute.after": "gate",
  "tool.definition": "gate",
  "chat.message": "gate",
  "chat.params": "gate",
  "chat.headers": "gate",
  "command.execute.before": "gate",
  "shell.env": "gate",
  "experimental.chat.messages.transform": "gate",
  "experimental.chat.system.transform": "gate",
  "experimental.session.compacting": "gate",
  "experimental.compaction.autocontinue": "gate",
  "experimental.text.complete": "gate",
  config: "observe",
  event: "observe",
  dispose: "observe",
};

export const DISPATCHABLE_EVENT_NAMES: readonly DispatchableEvent[] =
  Object.keys(DISPATCHABLE_EVENTS) as DispatchableEvent[];

/** Names that must never derive to a dispatchable event (R6.2). */
export const EXCLUDED_EVENT_NAMES: readonly string[] = [
  "permission.ask",
  "tool",
  "auth",
  "provider",
  "experimental.provider.small_model",
];

export const isExcludedEvent = (event: string): boolean =>
  EXCLUDED_EVENT_NAMES.includes(event);

export type HookDerivation =
  | {
      readonly kind: "dispatchable";
      readonly event: DispatchableEvent;
      readonly class: HookClass;
    }
  | { readonly kind: "excluded" }
  | { readonly kind: "unknown"; readonly event: string };

/**
 * Classifies a stem without filesystem access. Excluded names return a marker
 * with no event field so no consumer can mistake them for a dispatchable event.
 */
export const deriveHook = (stem: string): HookDerivation => {
  const event = toDottedEvent(stem);
  if (isExcludedEvent(event)) return { kind: "excluded" };
  if (Object.hasOwn(DISPATCHABLE_EVENTS, event)) {
    const dispatchable = event as DispatchableEvent;
    return {
      kind: "dispatchable",
      event: dispatchable,
      class: DISPATCHABLE_EVENTS[dispatchable],
    };
  }
  return { kind: "unknown", event };
};

/** `event` alone maps 1-to-1 onto a stem, so it fully determines entry order. */
interface HookOrderKey {
  readonly event: string;
  readonly extension: HookExtension;
}

// Plain code-unit comparison keeps ordering identical across locales; the
// registry, CLI, and TUI agree because they all call this comparator.
const compareStrings = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

const compareHookEntries = (a: HookOrderKey, b: HookOrderKey): number => {
  const byEvent = compareStrings(a.event, b.event);
  if (byEvent !== 0) return byEvent;
  return EXTENSION_RANK[a.extension] - EXTENSION_RANK[b.extension];
};

/* ── Interpreter resolution ───────────────────────────────────────────────── */

/** Injectable `Bun.which` seam; `null` means the executable is not on PATH. */
export type WhichInterpreter = (command: string) => string | null;

/** Display name shared by report rows and gate hints (R2.2). */
export const interpreterName = (interpreter: InterpreterResolution): string =>
  interpreter.resolved ?? interpreter.expected ?? "runtime";

/** Report-cell label rendered identically by every visibility surface. */
export const interpreterLabel = (interpreter: InterpreterResolution): string =>
  `${interpreterName(interpreter)} (${
    interpreter.available ? "available" : "missing"
  })`;

const firstAvailable = (
  which: WhichInterpreter,
  candidates: readonly string[],
): string | undefined => {
  for (const candidate of candidates) {
    const resolved = which(candidate);
    if (typeof resolved === "string" && resolved.length > 0) return resolved;
  }
  return undefined;
};

/**
 * Resolves interpreters once at init. A missing executable is only an
 * availability flag — never a registration error (R3.2, R5.3). `.ts`/`.js`
 * run in-process, `.sh` needs `bash`, and `.ps1` probes `pwsh` first, then the
 * Windows PowerShell fallback.
 */
export const resolveInterpreterAvailability = (
  which: WhichInterpreter = Bun.which,
): InterpreterAvailability => {
  const sh = firstAvailable(which, ["bash"]);
  const ps1 = firstAvailable(which, ["pwsh", "powershell.exe"]);
  return {
    ".ts": { available: true },
    ".js": { available: true },
    ".sh":
      sh === undefined
        ? { expected: "bash", available: false }
        : { resolved: sh, available: true },
    ".ps1":
      ps1 === undefined
        ? { expected: "pwsh", available: false }
        : { resolved: ps1, available: true },
  };
};

/* ── Strict digest ────────────────────────────────────────────────────────── */

const EXPECTED_EXTENSIONS = ".ts, .js, .sh, or .ps1";

const RECOVERY_HINT =
  "Hint: fix or remove the invalid file(s) and restart OpenCode. The owflow plugin — including the destructive-command guard — has been dropped until the hooks directory validates. To start without user hooks, set OWFLOW_HOOKS_DISABLED=1.";

const comparePaths = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

/** The dirent (not stat) check is deliberate: symlinks never count as regular files. */
const validateEntry = (
  dirent: Dirent,
  entryPath: string,
): HookScript | HookValidationFailure => {
  if (!dirent.isFile()) {
    return {
      path: entryPath,
      error: "not a regular file (only hook scripts belong in .owflow/hooks/)",
    };
  }
  const extension = path.extname(dirent.name);
  if (!isHookExtension(extension)) {
    return {
      path: entryPath,
      error: `extension "${extension || "(none)"}" is not routable (expected ${EXPECTED_EXTENSIONS})`,
    };
  }
  const stem = dirent.name.slice(0, dirent.name.length - extension.length);
  if (!HOOK_STEM_PATTERN.test(stem)) {
    return {
      path: entryPath,
      error: `stem "${stem}" is not lowercase kebab-case ([a-z0-9]+(-[a-z0-9]+)*)`,
    };
  }
  const derivation = deriveHook(stem);
  if (derivation.kind === "excluded") {
    return {
      path: entryPath,
      error: `stem "${stem}" derives to "${toDottedEvent(stem)}", an excluded event that cannot be hooked`,
    };
  }
  if (derivation.kind === "unknown") {
    return {
      path: entryPath,
      error: `stem "${stem}" derives to "${derivation.event}", which is not a dispatchable event`,
    };
  }
  return {
    path: entryPath,
    stem,
    event: derivation.event,
    class: derivation.class,
    runnerClass: runnerClassForExtension(extension),
    extension,
  };
};

const formatFatal = (failures: readonly HookValidationFailure[]): string => {
  const count =
    failures.length === 1 ? "1 invalid entry" : `${failures.length} invalid entries`;
  const rows = failures
    .map((failure) => `  - ${failure.path}: ${failure.error}`)
    .join("\n");
  return [`[owflow] ${count} in .owflow/hooks/`, rows, RECOVERY_HINT].join(
    "\n",
  );
};

/**
 * Enumerates one level of `hooksDir` and validates every entry. One
 * implementation serves both callers: `throw` is the fail-fast registry path,
 * `report` collects every violation as a row for the CLI. Entry order is
 * owned by `buildRegistry`; only failures are sorted here for stable reports.
 */
export const digest = (
  hooksDir: string,
  mode: HookDigestMode = "throw",
): HookDigest => {
  if (!fs.existsSync(hooksDir)) return { entries: [], failures: [] };
  if (!fs.statSync(hooksDir).isDirectory()) {
    const failures = [
      { path: hooksDir, error: "the hooks anchor exists but is not a directory" },
    ];
    if (mode === "throw") throw new Error(formatFatal(failures));
    return { entries: [], failures };
  }

  const entries: HookScript[] = [];
  const failures: HookValidationFailure[] = [];
  for (const dirent of fs.readdirSync(hooksDir, { withFileTypes: true })) {
    const entryPath = path.join(hooksDir, dirent.name);
    const validated = validateEntry(dirent, entryPath);
    if ("error" in validated) failures.push(validated);
    else entries.push(validated);
  }

  failures.sort((a, b) => comparePaths(a.path, b.path));
  if (mode === "throw" && failures.length > 0)
    throw new Error(formatFatal(failures));
  return { entries, failures };
};

/* ── Registry builder and unified scan ────────────────────────────────────── */

const statusFor = (
  script: HookScript,
  interpreter: InterpreterResolution,
): HookEntryStatus => {
  if (interpreter.available) return "registered";
  return script.class === "gate"
    ? "will-fail-closed"
    : "skipped-no-interpreter";
};

/**
 * Builds the single source of truth for dispatch and every report surface.
 * Entries are ordered once by `(event, extension rank)` so all surfaces agree
 * by construction (R2.2); nothing is persisted.
 */
export const buildRegistry = (
  scripts: readonly HookScript[],
  availability: InterpreterAvailability,
): HookRegistry => {
  const entries: HookRegistryEntry[] = [...scripts]
    .sort(compareHookEntries)
    .map((script) => {
      const interpreter = { ...availability[script.extension] };
      return {
        path: script.path,
        event: script.event,
        class: script.class,
        runnerClass: script.runnerClass,
        interpreter,
        status: statusFor(script, interpreter),
      };
    });

  const byEvent = {} as Record<DispatchableEvent, HookRegistryEntry[]>;
  for (const event of DISPATCHABLE_EVENT_NAMES) byEvent[event] = [];
  for (const entry of entries) byEvent[entry.event].push(entry);

  return { entries, byEvent };
};

export interface HookScanOptions {
  /** `throw` (default) is the fail-fast startup path; `report` collects violations. */
  readonly mode?: HookDigestMode;
  readonly which?: WhichInterpreter;
}

export interface HookScan {
  readonly registry: HookRegistry;
  readonly failures: readonly HookValidationFailure[];
}

/**
 * One-call scan shared by the startup, CLI, and TUI surfaces: digest the
 * directory, resolve interpreters, and build the registry. Callers stop
 * repeating the wiring and never see the intermediate `HookScript`.
 */
export const scanHooks = (
  hooksDir: string,
  options: HookScanOptions = {},
): HookScan => {
  const { entries, failures } = digest(hooksDir, options.mode ?? "throw");
  return {
    registry: buildRegistry(entries, resolveInterpreterAvailability(options.which)),
    failures,
  };
};
