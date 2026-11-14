import fs from 'node:fs';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import {
  EXCLUDED_EVENT_NAMES,
  HookDigestMode,
  HOOK_EVENT_NAMES,
  type HookEventName,
  type HookRegistryEntry,
  type HookScan,
  type HookValidationFailure,
  type InterpreterResolution,
} from '../types/hook-types.js';
import { hooksLocationLabel } from '../utils/workflow-paths.js';

const STEM_TO_EVENT = new Map<string, HookEventName>(HOOK_EVENT_NAMES.map((event) => [event.replaceAll('.', '-'), event]));
const EXCLUDED_STEMS = new Map<string, string>(EXCLUDED_EVENT_NAMES.map((event) => [event.replaceAll('.', '-'), event]));
export const IGNORED_FILENAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini', '.gitkeep']);

const isIgnoredFile = (name: string): boolean => {
  const lowerName = name.toLowerCase();
  return IGNORED_FILENAMES.has(lowerName) || lowerName.endsWith('.md') || name.endsWith('~') || name.endsWith('.swp');
};

const isLowercaseAsciiOrDigit = (character: string): boolean =>
  (character >= 'a' && character <= 'z') || (character >= '0' && character <= '9');

const isValidHookStem = (stem: string): boolean =>
  stem
    .split('-')
    .every((segment) => segment.length > 0 && [...segment].every((character) => isLowercaseAsciiOrDigit(character)));

type HookNameValidation =
  | { readonly isValid: true; readonly event: HookEventName }
  | { readonly isValid: false; readonly error: string };

const validateHookEvent = (stem: string): HookNameValidation => {
  if (!isValidHookStem(stem)) {
    return { isValid: false, error: `stem "${stem}" is not lowercase kebab-case ([a-z0-9]+(-[a-z0-9]+)*)` };
  }
  const excludedEvent = EXCLUDED_STEMS.get(stem);
  if (excludedEvent) {
    return { isValid: false, error: `stem "${stem}" derives to "${excludedEvent}", an excluded event that cannot be hooked` };
  }
  const event = STEM_TO_EVENT.get(stem);
  if (!event) {
    return {
      isValid: false,
      error: `stem "${stem}" derives to "${stem.replaceAll('-', '.')}", which is not a dispatchable hook or a known host event`,
    };
  }
  return { isValid: true, event };
};

interface HookScanState {
  readonly hooksDirectory: string;
  readonly interpreters: Record<'.sh' | '.ps1', InterpreterResolution>;
  readonly entries: HookRegistryEntry[];
  readonly failures: HookValidationFailure[];
  readonly seenStems: Map<string, HookRegistryEntry>;
}

interface ResolvedHook {
  readonly stem: string;
  readonly entry: HookRegistryEntry;
}

interface ValidationFailureTarget {
  readonly state: HookScanState;
  readonly entryPath: string;
  readonly error: string;
}

const failValidation = (target: ValidationFailureTarget): void => {
  target.state.failures.push({ path: target.entryPath, error: target.error });
};

const resolveHookScript = (dirent: Dirent, state: HookScanState): ResolvedHook | undefined => {
  const entryPath = path.join(state.hooksDirectory, dirent.name);
  if (!dirent.isFile()) {
    failValidation({ state, entryPath, error: `not a regular file (only hook scripts belong in ${hooksLocationLabel}/)` });
    return;
  }
  const extension = path.extname(dirent.name);
  if (extension !== '.sh' && extension !== '.ps1') {
    failValidation({ state, entryPath, error: `extension "${extension || '(none)'}" is not routable (expected .sh or .ps1)` });
    return;
  }
  const stem = dirent.name.slice(0, -extension.length);
  const validation = validateHookEvent(stem);
  if (!validation.isValid) {
    failValidation({ state, entryPath, error: validation.error });
    return;
  }
  const interpreter = extension === '.sh' ? state.interpreters['.sh'] : state.interpreters['.ps1'];
  return {
    stem,
    entry: {
      path: entryPath,
      event: validation.event,
      interpreter,
      status: interpreter.available ? 'registered' : 'will-fail-closed',
    },
  };
};

const registerHookEntry = (resolvedHook: ResolvedHook, state: HookScanState): void => {
  const existing = state.seenStems.get(resolvedHook.stem);
  if (!existing) {
    state.seenStems.set(resolvedHook.stem, resolvedHook.entry);
    state.entries.push(resolvedHook.entry);
    return;
  }

  const names = `${path.basename(existing.path)}, ${path.basename(resolvedHook.entry.path)}`;
  const error = `hook name "${resolvedHook.stem}" is provided by multiple files (${names}); define it in exactly one format`;
  state.failures.push({ path: resolvedHook.entry.path, error });

  const existingIndex = state.entries.findIndex((entry) => entry.path === existing.path);
  if (existingIndex === -1) return;
  state.entries.splice(existingIndex, 1);
  state.failures.push({ path: existing.path, error });
};

const scanEntries = (state: HookScanState): void => {
  const dirents = fs.readdirSync(state.hooksDirectory, { withFileTypes: true });
  for (const dirent of dirents) {
    if (isIgnoredFile(dirent.name)) continue;
    const resolvedHook = resolveHookScript(dirent, state);
    if (resolvedHook) registerHookEntry(resolvedHook, state);
  }
};

const resolveInterpreters = (which: (command: string) => string | null): Record<'.sh' | '.ps1', InterpreterResolution> => {
  const bashPath = which('bash') ?? undefined;
  const powershellPath = which('pwsh') ?? which('powershell.exe') ?? undefined;
  return {
    '.sh': { expected: 'bash', available: Boolean(bashPath), ...(bashPath && { resolved: bashPath }) },
    '.ps1': { expected: 'pwsh', available: Boolean(powershellPath), ...(powershellPath && { resolved: powershellPath }) },
  };
};

const RECOVERY_HINT =
  'Hint: fix or remove the invalid file(s) and restart OpenCode. User hooks are bypassed until the hooks directory validates; the built-in destructive-command guard remains active. To start without user hooks, set OWFLOW_HOOKS_DISABLED=1.';

export const scanHooks = (
  hooksDirectory: string,
  options: { mode?: HookDigestMode; which?: (command: string) => string | null } = {},
): HookScan => {
  if (!fs.existsSync(hooksDirectory)) return { entries: [], failures: [] };

  if (!fs.statSync(hooksDirectory).isDirectory()) {
    const failures = [{ path: hooksDirectory, error: `the hooks anchor exists but is not a directory (${hooksLocationLabel})` }];
    if ((options.mode ?? HookDigestMode.FailFast) === HookDigestMode.FailFast) throw new Error(formatFatal(failures));
    return { entries: [], failures };
  }

  const mode = options.mode ?? HookDigestMode.FailFast;
  const which = options.which ?? Bun.which;
  const state: HookScanState = {
    hooksDirectory,
    interpreters: resolveInterpreters(which),
    entries: [],
    failures: [],
    seenStems: new Map<string, HookRegistryEntry>(),
  };
  scanEntries(state);
  state.entries.sort((firstEntry, secondEntry) => firstEntry.event.localeCompare(secondEntry.event));
  state.failures.sort((firstFailure, secondFailure) => firstFailure.path.localeCompare(secondFailure.path));
  if (mode === HookDigestMode.FailFast && state.failures.length > 0) {
    throw new Error(formatFatal(state.failures));
  }
  return { entries: state.entries, failures: state.failures };
};

const formatFatal = (failures: readonly HookValidationFailure[]): string => {
  const count = failures.length === 1 ? '1 invalid entry' : `${failures.length} invalid entries`;
  const rows = failures.map((failure) => `  - ${failure.path}: ${failure.error}`).join('\n');
  return `[owflow] ${count} in ${hooksLocationLabel}/\n${rows}\n${RECOVERY_HINT}`;
};
