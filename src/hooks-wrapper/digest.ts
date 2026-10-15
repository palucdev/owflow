import fs from "node:fs";
import type { Dirent } from "node:fs";
import path from "node:path";
import {
  HOOK_STEM_PATTERN,
  compareHookEntries,
  deriveHook,
  isHookExtension,
  runnerClassForExtension,
  toDottedEvent,
} from "./derivation.js";
import type {
  HookDigest,
  HookDigestMode,
  HookScript,
  HookValidationFailure,
} from "./types.js";

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
 * `report` collects every violation as a row for the CLI.
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

  entries.sort(compareHookEntries);
  failures.sort((a, b) => comparePaths(a.path, b.path));
  if (mode === "throw" && failures.length > 0)
    throw new Error(formatFatal(failures));
  return { entries, failures };
};
