import fs from 'node:fs';
import path from 'node:path';
import {
  EXCLUDED_EVENT_NAMES,
  HookDigestMode,
  isHookEventName,
  type HookRegistryEntry,
  type HookScan,
  type HookValidationFailure,
  type InterpreterResolution,
} from '../types/hook-types.js';
import { hooksLocationLabel } from '../utils/workflow-paths.js';

const HOOK_STEM_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
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

  const raw: Array<{ stem: string; entry: HookRegistryEntry }> = [];
  const failures: HookValidationFailure[] = [];

  for (const dirent of fs.readdirSync(hooksDir, { withFileTypes: true })) {
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
    const event = stem.replaceAll('-', '.');
    if ((EXCLUDED_EVENT_NAMES as readonly string[]).includes(event)) {
      failures.push({ path: entryPath, error: `stem "${stem}" derives to "${event}", an excluded event that cannot be hooked` });
      continue;
    }
    if (!isHookEventName(event)) {
      failures.push({ path: entryPath, error: `stem "${stem}" derives to "${event}", which is not a dispatchable hook or a known host event` });
      continue;
    }
    const interpreter = interpreters[ext];
    raw.push({
      stem,
      entry: {
        path: entryPath,
        event,
        interpreter,
        status: interpreter.available ? 'registered' : 'will-fail-closed',
      },
    });
  }

  const byStem = Map.groupBy(raw, (item) => item.stem);
  const entries: HookRegistryEntry[] = [];
  for (const [stem, group] of byStem) {
    if (group.length === 1) {
      entries.push(group[0]!.entry);
      continue;
    }
    const names = group.map((g) => path.basename(g.entry.path)).join(', ');
    for (const g of group) {
      failures.push({
        path: g.entry.path,
        error: `hook name "${stem}" is provided by multiple files (${names}); define it in exactly one format`,
      });
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
