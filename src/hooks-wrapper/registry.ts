/**
 * Hook registry: naming/extension tables, interpreter resolution, strict
 * directory digest, and the unified `scanHooks` scan. The shared model and
 * event table live in `src/types/hook-types.ts`; every module under
 * `src/hooks-wrapper/` stays platform-agnostic by contract.
 */

import fs from "node:fs";
import type { Dirent } from "node:fs";
import path from "node:path";

import {
  DISPATCHABLE_EVENTS,
  DISPATCHABLE_EVENT_NAMES,
  EXCLUDED_EVENT_NAMES,
  HookDigestMode,
} from "../types/hook-types.js";
import type {
  DispatchableEvent,
  EnvelopeContext,
  EnvelopeResult,
  HookClass,
  HookDerivation,
  HookDigest,
  HookEntryStatus,
  HookExtension,
  HookRegistry,
  HookRegistryEntry,
  HookScan,
  HookScanOptions,
  HookScript,
  HookValidationFailure,
  InterpreterAvailability,
  InterpreterResolution,
  Outcome,
  OutcomeStatus,
  RunnerClass,
  WhichInterpreter,
} from "../types/hook-types.js";
import { hooksLocationLabel } from "../utils/workflow-paths.js";
import { compareStrings } from "./shared.js";

export {
  DISPATCHABLE_EVENTS,
  DISPATCHABLE_EVENT_NAMES,
  EXCLUDED_EVENT_NAMES,
  HookDigestMode,
};
export type {
  DispatchableEvent,
  EnvelopeContext,
  EnvelopeResult,
  HookClass,
  HookDerivation,
  HookDigest,
  HookEntryStatus,
  HookExtension,
  HookRegistry,
  HookRegistryEntry,
  HookScan,
  HookScanOptions,
  HookScript,
  HookValidationFailure,
  InterpreterAvailability,
  InterpreterResolution,
  Outcome,
  OutcomeStatus,
  RunnerClass,
  WhichInterpreter,
};

/* ── Naming, extensions, and the event table ──────────────────────────────── */

/** Stems accepted by the digest: `[a-z0-9]+(-[a-z0-9]+)*`. */
export const HOOK_STEM_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const HOOK_EXTENSIONS: readonly HookExtension[] = [
  ".ts",
  ".js",
  ".sh",
  ".ps1",
];

/** Fixed rank keeps the report order deterministic (one format per hook name). */
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

export const isExcludedEvent = (event: string): boolean =>
  EXCLUDED_EVENT_NAMES.includes(event);

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

const compareHookEntries = (a: HookOrderKey, b: HookOrderKey): number => {
  const byEvent = compareStrings(a.event, b.event);
  if (byEvent !== 0) return byEvent;
  return EXTENSION_RANK[a.extension] - EXTENSION_RANK[b.extension];
};

/* ── Interpreter resolution ───────────────────────────────────────────────── */

/** Display name shared by report rows and gate hints. */
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
 * availability flag — never a registration error. `.ts`/`.js` run in-process,
 * `.sh` needs `bash`, and `.ps1` probes `pwsh` first, then the Windows
 * PowerShell fallback.
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

/** The dirent (not stat) check is deliberate: symlinks never count as regular files. */
const validateEntry = (
  dirent: Dirent,
  entryPath: string,
): HookScript | HookValidationFailure => {
  if (!dirent.isFile()) {
    return {
      path: entryPath,
      error: `not a regular file (only hook scripts belong in ${hooksLocationLabel}/)`,
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

const duplicateStemFailures = (
  entries: readonly HookScript[],
): { readonly kept: HookScript[]; readonly failures: HookValidationFailure[] } => {
  const byStem = new Map<string, HookScript[]>();
  for (const entry of entries) {
    const group = byStem.get(entry.stem);
    if (group === undefined) byStem.set(entry.stem, [entry]);
    else group.push(entry);
  }

  const kept: HookScript[] = [];
  const failures: HookValidationFailure[] = [];
  for (const group of byStem.values()) {
    if (group.length === 1) {
      kept.push(group[0]!);
      continue;
    }
    const formats = group.map((entry) => path.basename(entry.path)).join(", ");
    for (const entry of group) {
      failures.push({
        path: entry.path,
        error: `hook name "${entry.stem}" is provided by multiple files (${formats}); define it in exactly one format`,
      });
    }
  }
  return { kept, failures };
};

const formatFatal = (failures: readonly HookValidationFailure[]): string => {
  const count =
    failures.length === 1 ? "1 invalid entry" : `${failures.length} invalid entries`;
  const rows = failures
    .map((failure) => `  - ${failure.path}: ${failure.error}`)
    .join("\n");
  return [`[owflow] ${count} in ${hooksLocationLabel}/`, rows, RECOVERY_HINT].join(
    "\n",
  );
};

/**
 * Enumerates one level of `hooksDir` and validates every entry. One
 * implementation serves both callers: `FailFast` is the fail-fast registry
 * path, `Report` collects every violation as a row for the CLI/TUI. Entry
 * order is owned by `buildRegistry`; only failures are sorted here for stable
 * reports.
 */
export const digest = (
  hooksDir: string,
  mode: HookDigestMode = HookDigestMode.FailFast,
): HookDigest => {
  if (!fs.existsSync(hooksDir)) return { entries: [], failures: [] };
  if (!fs.statSync(hooksDir).isDirectory()) {
    const failures = [
      {
        path: hooksDir,
        error: `the hooks anchor exists but is not a directory (${hooksLocationLabel})`,
      },
    ];
    if (mode === HookDigestMode.FailFast) throw new Error(formatFatal(failures));
    return { entries: [], failures };
  }

  const validated: HookScript[] = [];
  const failures: HookValidationFailure[] = [];
  for (const dirent of fs.readdirSync(hooksDir, { withFileTypes: true })) {
    const entryPath = path.join(hooksDir, dirent.name);
    const validatedEntry = validateEntry(dirent, entryPath);
    if ("error" in validatedEntry) failures.push(validatedEntry);
    else validated.push(validatedEntry);
  }

  const duplicates = duplicateStemFailures(validated);
  failures.push(...duplicates.failures);

  failures.sort((a, b) => compareStrings(a.path, b.path));
  if (mode === HookDigestMode.FailFast && failures.length > 0)
    throw new Error(formatFatal(failures));
  return { entries: duplicates.kept, failures };
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
 * by construction; nothing is persisted.
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

/**
 * One-call scan shared by the startup, CLI, and TUI surfaces: digest the
 * directory, resolve interpreters, and build the registry. Callers stop
 * repeating the wiring and never see the intermediate `HookScript`.
 */
export const scanHooks = (
  hooksDir: string,
  options: HookScanOptions = {},
): HookScan => {
  const { entries, failures } = digest(
    hooksDir,
    options.mode ?? HookDigestMode.FailFast,
  );
  return {
    registry: buildRegistry(
      entries,
      resolveInterpreterAvailability(options.which),
    ),
    failures,
  };
};
