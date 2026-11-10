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
} from '../types/hook-types.js';

export * from '../types/hook-types.js';

export const STATUS_FILE_ENV = 'OWFLOW_HOOKS_STATUS_FILE';
export const LOG_FILE_ENV = 'OWFLOW_HOOK_LOGS_FILE';
const DEFAULT_LOG_ROTATION_BYTES = 4 * 1024 * 1024;

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

export const getUserTmpDir = (): string => {
  const uid = typeof process.getuid === 'function' ? String(process.getuid()) : (process.env.USER ?? process.env.USERNAME ?? 'default');
  return path.join(os.tmpdir(), `opencode-${uid}`);
};

export const resolveHooksStatusFile = (workspace: string): string =>
  process.env[STATUS_FILE_ENV] ?? path.join(getUserTmpDir(), `owflow-hooks-${workspaceKey(workspace)}.json`);

export const resolveHooksLogFile = (workspace: string): string =>
  process.env[LOG_FILE_ENV] ?? path.join(getUserTmpDir(), `owflow-hook-logs-${workspaceKey(workspace)}.jsonl`);

export const resolveHooksLatestSymlink = (workspace: string): string => {
  const symlinkPath = path.join(getUserTmpDir(), 'owflow-hooks-latest.jsonl');
  const target = resolveHooksLogFile(workspace);
  try {
    fs.mkdirSync(path.dirname(symlinkPath), { recursive: true, mode: 0o700 });
    try {
      const stat = fs.lstatSync(symlinkPath);
      if (stat.isSymbolicLink() || stat.isFile()) {
        fs.unlinkSync(symlinkPath);
      }
    } catch {}
    fs.symlinkSync(target, symlinkPath);
  } catch {
    // Best-effort symlink creation
  }
  return symlinkPath;
};

export const appendWithRotation = (filePath: string, line: string, maxBytes = DEFAULT_LOG_ROTATION_BYTES): void => {
  if (!line) return;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    try {
      const stat = fs.lstatSync(filePath);
      if (stat.isSymbolicLink()) return;
      if (stat.size > maxBytes) {
        try {
          const rotStat = fs.lstatSync(`${filePath}.1`);
          if (rotStat.isSymbolicLink()) fs.unlinkSync(`${filePath}.1`);
        } catch {}
        fs.renameSync(filePath, `${filePath}.1`);
      }
    } catch (err: any) {
      if (err?.code !== 'ENOENT') return;
    }
    const content = line.endsWith('\n') ? line : `${line}\n`;
    fs.appendFileSync(filePath, content, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // Best-effort log persistence never affects hook execution.
  }
};

export const writeHookCrashLog = (workspace: string, source: string, error: unknown): void => {
  try {
    const crashFile = path.join(getUserTmpDir(), 'owflow-hooks-crash.log');
    const timestamp = new Date().toISOString();
    const errStr = error instanceof Error ? (error.stack ?? error.message) : String(error);
    const entry = `[${timestamp}] [${source}] [workspace: ${workspace}]\n${errStr}\n\n`;
    appendWithRotation(crashFile, entry);
  } catch {
    // Best-effort crash logging never throws
  }
};

interface FileCacheEntry<T> {
  readonly mtimeMs: number;
  readonly size: number;
  readonly value: T;
}

const statusFileCache = new Map<string, FileCacheEntry<HookStatusReadResult>>();
const logRecordsCache = new Map<string, FileCacheEntry<HookLogReadResult>>();

export const readHookStatusSnapshot = (file: string): HookStatusReadResult => {
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) return { kind: 'invalid' };
    const cached = statusFileCache.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.value;
    }
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed?.version !== 1 || typeof parsed.hooks !== 'object' || parsed.hooks === null) {
      return { kind: 'invalid' };
    }
    const result: HookStatusReadResult = { kind: 'ok', snapshot: parsed as HookStatusSnapshot };
    statusFileCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, value: result });
    return result;
  } catch (error) {
    statusFileCache.delete(file);
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
    const cached = logRecordsCache.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.value;
    }
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
    const result: HookLogReadResult = { kind: 'ok', records, truncated: false };
    logRecordsCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, value: result });
    return result;
  } catch (error) {
    logRecordsCache.delete(file);
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
      if (r.sessionID !== sessionID && r.sessionID !== undefined) return false;
    }
    return r.startedAt >= since;
  });
};
