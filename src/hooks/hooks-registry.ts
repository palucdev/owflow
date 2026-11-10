import fs from 'node:fs';
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

const HOOK_STEM_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STEM_TO_EVENT = new Map<string, HookEventName>(HOOK_EVENT_NAMES.map((ev) => [ev.replaceAll('.', '-'), ev]));
const EXCLUDED_STEMS = new Map<string, string>(EXCLUDED_EVENT_NAMES.map((ev) => [ev.replaceAll('.', '-'), ev]));
export const IGNORED_FILENAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini', '.gitkeep']);

const isIgnoredFile = (name: string): boolean => {
  const lower = name.toLowerCase();
  return IGNORED_FILENAMES.has(lower) || lower.endsWith('.md') || name.endsWith('~') || name.endsWith('.swp');
};

const RECOVERY_HINT =
  'Hint: fix or remove the invalid file(s) and restart OpenCode. The owflow plugin — including the destructive-command guard — has been dropped until the hooks directory validates. To start without user hooks, set OWFLOW_HOOKS_DISABLED=1.';

export const scanHooks = (hooksDir: string, options: { mode?: HookDigestMode; which?: (cmd: string) => string | null } = {}): HookScan => {
  const mode = options.mode ?? HookDigestMode.FailFast;
  const which = options.which ?? Bun.which;
  if (!fs.existsSync(hooksDir)) return { entries: [], failures: [] };
  if (!fs.statSync(hooksDir).isDirectory()) {
    const failures = [{ path: hooksDir, error: `the hooks anchor exists but is not a directory (${hooksLocationLabel})` }];
    if (mode === HookDigestMode.FailFast) throw new Error(formatFatal(failures));
    return { entries: [], failures };
  }

  const sh = which('bash') ?? undefined;
  const ps1 = which('pwsh') ?? which('powershell.exe') ?? undefined;
  const interpreters: Record<'.sh' | '.ps1', InterpreterResolution> = {
    '.sh': { expected: 'bash', available: Boolean(sh), ...(sh ? { resolved: sh } : {}) },
    '.ps1': { expected: 'pwsh', available: Boolean(ps1), ...(ps1 ? { resolved: ps1 } : {}) },
  };

  const entries: HookRegistryEntry[] = [];
  const failures: HookValidationFailure[] = [];
  const seenStems = new Map<string, HookRegistryEntry>();

  for (const dirent of fs.readdirSync(hooksDir, { withFileTypes: true })) {
    if (isIgnoredFile(dirent.name)) continue;

    const entryPath = path.join(hooksDir, dirent.name);
    if (!dirent.isFile()) {
      failures.push({ path: entryPath, error: `not a regular file (only hook scripts belong in ${hooksLocationLabel}/)` });
      continue;
    }
    const ext = path.extname(dirent.name);
    if (ext !== '.sh' && ext !== '.ps1') {
      failures.push({ path: entryPath, error: `extension "${ext || '(none)'}" is not routable (expected .sh or .ps1)` });
      continue;
    }
    const stem = dirent.name.slice(0, -ext.length);
    if (!HOOK_STEM_PATTERN.test(stem)) {
      failures.push({ path: entryPath, error: `stem "${stem}" is not lowercase kebab-case ([a-z0-9]+(-[a-z0-9]+)*)` });
      continue;
    }
    const excluded = EXCLUDED_STEMS.get(stem);
    if (excluded) {
      failures.push({ path: entryPath, error: `stem "${stem}" derives to "${excluded}", an excluded event that cannot be hooked` });
      continue;
    }
    const event = STEM_TO_EVENT.get(stem);
    if (!event) {
      failures.push({
        path: entryPath,
        error: `stem "${stem}" derives to "${stem.replaceAll('-', '.')}", which is not a dispatchable hook or a known host event`,
      });
      continue;
    }

    const interpreter = interpreters[ext];
    const entry: HookRegistryEntry = {
      path: entryPath,
      event,
      interpreter,
      status: interpreter.available ? 'registered' : 'will-fail-closed',
    };

    const existing = seenStems.get(stem);
    if (existing) {
      const names = `${path.basename(existing.path)}, ${path.basename(entryPath)}`;
      failures.push({
        path: entryPath,
        error: `hook name "${stem}" is provided by multiple files (${names}); define it in exactly one format`,
      });
      const existingIdx = entries.findIndex((e) => e.path === existing.path);
      if (existingIdx !== -1) {
        entries.splice(existingIdx, 1);
        failures.push({
          path: existing.path,
          error: `hook name "${stem}" is provided by multiple files (${names}); define it in exactly one format`,
        });
      }
    } else {
      seenStems.set(stem, entry);
      entries.push(entry);
    }
  }

  entries.sort((a, b) => (a.event < b.event ? -1 : a.event > b.event ? 1 : 0));
  failures.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (mode === HookDigestMode.FailFast && failures.length > 0) {
    throw new Error(formatFatal(failures));
  }
  return { entries, failures };
};

const formatFatal = (failures: readonly HookValidationFailure[]): string => {
  const count = failures.length === 1 ? '1 invalid entry' : `${failures.length} invalid entries`;
  const rows = failures.map((f) => `  - ${f.path}: ${f.error}`).join('\n');
  return `[owflow] ${count} in ${hooksLocationLabel}/\n${rows}\n${RECOVERY_HINT}`;
};
