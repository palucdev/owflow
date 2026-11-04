import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hooksLocationLabel } from '../utils/workflow-paths.js';
import {
  EXCLUDED_EVENT_NAMES,
  HookDigestMode,
  isHookEventName,
  type HookEventName,
  type HookLogReadResult,
  type HookRegistryEntry,
  type HookReportInput,
  type HookReportRow,
  type HookRunLogRecord,
  type HookScan,
  type HookStatusReadResult,
  type HookStatusSnapshot,
  type HookValidationFailure,
  type InterpreterResolution,
} from '../types/hook-types.js';

export * from '../types/hook-types.js';
export * from './hooks-wrapper.js';

/* ── Discovery & Scan ─────────────────────────────────────────────────────── */

const HOOK_STEM_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RECOVERY_HINT =
  'Hint: fix or remove the invalid file(s) and restart OpenCode. The owflow plugin — including the destructive-command guard — has been dropped until the hooks directory validates. To start without user hooks, set OWFLOW_HOOKS_DISABLED=1.';

export const interpreterLabel = (i: InterpreterResolution): string => `${i.resolved ?? i.expected} (${i.available ? 'available' : 'missing'})`;

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

/* ── Reporting ────────────────────────────────────────────────────────────── */

export const EFFECTIVE_AFTER_RESTART = 'effective after next restart';
export const TABLE_COLUMNS = ['path', 'event', 'interpreter', 'status'] as const;

export const buildReportRows = (input: HookReportInput): readonly HookReportRow[] => [
  ...(input.bypassed ? [{ path: '(all hooks)', event: '-', interpreter: '-', status: 'hooks bypassed (OWFLOW_HOOKS_DISABLED=1)' }] : []),
  ...input.entries.map((e) => ({
    path: e.path,
    event: e.event,
    interpreter: interpreterLabel(e.interpreter),
    status: e.status === 'registered' ? 'registered' : 'will fail closed at fire',
  })),
  ...(input.failures ?? []).map((f) => ({
    path: f.path,
    event: '-',
    interpreter: '-',
    status: `invalid: ${f.error}`,
  })),
];

export const renderTable = (input: HookReportInput): string => {
  const grid = [[...TABLE_COLUMNS], ...buildReportRows(input).map((r) => [r.path, r.event, r.interpreter, r.status])];
  const widths = TABLE_COLUMNS.map((_, i) => Math.max(...grid.map((row) => row[i]!.length)));
  const lines = grid.map((row) =>
    row
      .map((c, i) => c.padEnd(widths[i]!))
      .join('  ')
      .trimEnd(),
  );
  return [...lines, '', EFFECTIVE_AFTER_RESTART].join('\n');
};

export const renderSnapshot = (input: HookReportInput): readonly string[] => {
  const invalid = input.failures?.length ?? 0;
  const head = `[owflow] hooks: ${input.entries.length} loaded${invalid > 0 ? `, ${invalid} invalid` : ''}`;
  return [head, ...buildReportRows(input).map((r) => `[owflow]   ${r.path} -> ${r.event} ${r.interpreter} - ${r.status}`)];
};

export const renderJson = (input: HookReportInput): string =>
  JSON.stringify({ label: EFFECTIVE_AFTER_RESTART, bypassed: input.bypassed === true, rows: buildReportRows(input) }, null, 2);

/* ── Status & Log Persistence ─────────────────────────────────────────────── */

export const STATUS_FILE_ENV = 'OWFLOW_HOOKS_STATUS_FILE';
export const LOG_FILE_ENV = 'OWFLOW_HOOK_LOGS_FILE';

const workspaceKey = (workspace: string): string => {
  let resolved = path.resolve(workspace);
  try {
    resolved = fs.realpathSync.native(resolved);
  } catch {
    // keep resolved path when workspace does not exist yet
  }
  return crypto
    .createHash('sha256')
    .update(process.platform === 'win32' ? resolved.toLowerCase() : resolved)
    .digest('hex')
    .slice(0, 16);
};

export const resolveHooksStatusFile = (workspace: string): string =>
  process.env[STATUS_FILE_ENV] ?? path.join(os.tmpdir(), 'opencode', `owflow-hooks-${workspaceKey(workspace)}.json`);

export const resolveHooksLogFile = (workspace: string): string =>
  process.env[LOG_FILE_ENV] ?? path.join(os.tmpdir(), 'opencode', `owflow-hook-logs-${workspaceKey(workspace)}.jsonl`);

export const readHookStatusSnapshot = (file: string): HookStatusReadResult => {
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) return { kind: 'invalid' };
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed?.version !== 1 || typeof parsed.hooks !== 'object' || parsed.hooks === null) {
      return { kind: 'invalid' };
    }
    return { kind: 'ok', snapshot: parsed as HookStatusSnapshot };
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? { kind: 'missing' } : { kind: 'invalid' };
  }
};

// shortcut: reads full JSONL file via readFileSync instead of a 512KB fd tail-seek and relies on 16KB stream caps;
// ceiling: log files >4MB rotation cap;
// upgrade: fs.openSync tail-slice reader.
export const readHookLogRecords = (file: string): HookLogReadResult => {
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) return { kind: 'invalid' };
    const raw = fs.readFileSync(file, 'utf8');
    const records: HookRunLogRecord[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        if (rec?.version === 1 && typeof rec.event === 'string' && typeof rec.name === 'string') {
          records.push(rec as HookRunLogRecord);
        }
      } catch {
        // skip malformed lines
      }
    }
    return { kind: 'ok', records, truncated: false };
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? { kind: 'missing' } : { kind: 'invalid' };
  }
};

export const readLatestHookLog = (
  file: string,
  event: HookEventName,
  since = Number.NEGATIVE_INFINITY,
  sessionID?: string,
): HookRunLogRecord | undefined => {
  const records = readSessionHookLogs(file, event, since, sessionID);
  return records.length > 0 ? records[records.length - 1] : undefined;
};

export const readSessionLatestLogs = (file: string, sessionID: string): Map<string, HookRunLogRecord> => {
  const map = new Map<string, HookRunLogRecord>();
  if (!sessionID) return map;
  const result = readHookLogRecords(file);
  if (result.kind !== 'ok') return map;
  for (const record of result.records) {
    if (record.sessionID === sessionID) {
      map.set(record.event, record);
    }
  }
  return map;
};

export const readSessionHookLogs = (
  file: string,
  event: HookEventName,
  since = Number.NEGATIVE_INFINITY,
  sessionID?: string,
): readonly HookRunLogRecord[] => {
  const result = readHookLogRecords(file);
  if (result.kind !== 'ok') return [];
  return result.records.filter((r) => {
    if (r.event !== event) return false;
    if (sessionID !== undefined && sessionID.length > 0) {
      if (r.sessionID === sessionID) return true;
      if (r.sessionID !== undefined) return false;
    }
    return r.startedAt >= since;
  });
};
