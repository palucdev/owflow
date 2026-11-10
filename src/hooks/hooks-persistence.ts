import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  type HookEventName,
  type HookLogReadResult,
  type HookRunLogRecord,
  type HookStatusReadResult,
  type HookStatusSnapshot,
  type HookStreamLogFiles,
} from '../types/hook-types.js';

export * from '../types/hook-types.js';

export const STATUS_FILE_ENV = 'OWFLOW_HOOKS_STATUS_FILE';
export const LOG_FILE_ENV = 'OWFLOW_HOOK_LOGS_FILE';
const MAX_STREAM_LOG_FILE_BYTES = 4 * 1024 * 1024;

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

export const resolveHookStreamLogFiles = (logFile: string, hookName: string, sessionID?: string): HookStreamLogFiles => {
  const dir = path.dirname(logFile);
  const sessionPrefix = sessionID && sessionID.trim().length > 0 ? path.basename(sessionID.trim()) : 'global';
  const safeHook = path.basename(hookName.trim());
  return {
    stdout: path.join(dir, `${sessionPrefix}.${safeHook}.stdout.log`),
    stderr: path.join(dir, `${sessionPrefix}.${safeHook}.stderr.log`),
  };
};

export const appendHookStreamLog = (file: string, chunk: string): void => {
  if (!chunk) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    if (fs.existsSync(file)) {
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) return;
      if (stat.size > MAX_STREAM_LOG_FILE_BYTES) fs.renameSync(file, `${file}.1`);
    }
    fs.appendFileSync(file, chunk, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // Best-effort log persistence never affects hook execution.
  }
};

const readTextFileSafe = (file: string): string => {
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) return '';
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};

export const readHookStreamLogs = (logFile: string, hookName: string, sessionID?: string): HookStreamLogFiles => {
  const files = resolveHookStreamLogFiles(logFile, hookName, sessionID);
  const stdout = readTextFileSafe(files.stdout);
  const stderr = readTextFileSafe(files.stderr);
  if (stdout.length > 0 || stderr.length > 0 || !sessionID) {
    return { stdout, stderr };
  }
  const globalFiles = resolveHookStreamLogFiles(logFile, hookName);
  return {
    stdout: readTextFileSafe(globalFiles.stdout),
    stderr: readTextFileSafe(globalFiles.stderr),
  };
};

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
