import fs from 'node:fs';
import {
  type HookEventName,
  type HookLogReadResult,
  type HookRunLogRecord,
  type HookStatusReadResult,
  type HookStatusSnapshot,
} from '../types/hook-types.js';

const BYTES_PER_KILOBYTE = 1024;
const TAIL_READ_KILOBYTES = 256;
export const MAX_LOG_TAIL_READ_BYTES = TAIL_READ_KILOBYTES * BYTES_PER_KILOBYTE;
export const DEFAULT_MAX_LOG_RECORDS = 500;

interface FileCacheEntry<T> {
  readonly mtimeMs: number;
  readonly size: number;
  readonly value: T;
}

const statusFileCache = new Map<string, FileCacheEntry<HookStatusReadResult>>();
const logRecordsCache = new Map<string, FileCacheEntry<HookLogReadResult>>();

const parseSnapshotData = (rawText: string): HookStatusSnapshot | undefined => {
  try {
    const parsed = JSON.parse(rawText);
    return parsed?.version === 1 && typeof parsed.hooks === 'object' && parsed.hooks !== null
      ? (parsed as HookStatusSnapshot)
      : undefined;
  } catch {
    return undefined;
  }
};

export const readHookStatusSnapshot = (file: string): HookStatusReadResult => {
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return { kind: 'invalid' };
    }
    const cached = statusFileCache.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.value;
    }
    const snapshot = parseSnapshotData(fs.readFileSync(file, 'utf8'));
    if (!snapshot) {
      return { kind: 'invalid' };
    }
    const result: HookStatusReadResult = { kind: 'ok', snapshot };
    statusFileCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, value: result });
    return result;
  } catch (error) {
    statusFileCache.delete(file);
    return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
      ? { kind: 'missing' }
      : { kind: 'invalid' };
  }
};

const readTailString = (
  file: string,
  fileSize: number,
): { rawText: string; isTruncated: boolean } => {
  const startOffset = Math.max(0, fileSize - MAX_LOG_TAIL_READ_BYTES);
  const readLength = fileSize - startOffset;

  const fileDescriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  const buffer = Buffer.alloc(readLength);
  try {
    fs.readSync(fileDescriptor, buffer, 0, readLength, startOffset);
  } finally {
    fs.closeSync(fileDescriptor);
  }

  const raw = buffer.toString('utf8');
  if (startOffset > 0) {
    const newlineIndex = raw.indexOf('\n');
    return {
      rawText: newlineIndex === -1 ? '' : raw.slice(newlineIndex + 1),
      isTruncated: true,
    };
  }
  return { rawText: raw, isTruncated: false };
};

const parseLogLineRecords = (rawText: string): HookRunLogRecord[] => {
  const records: HookRunLogRecord[] = [];
  for (const line of rawText.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsedRecord = JSON.parse(line);
      if (
        parsedRecord?.version === 1 &&
        typeof parsedRecord.event === 'string' &&
        typeof parsedRecord.name === 'string'
      ) {
        records.push(parsedRecord as HookRunLogRecord);
      }
    } catch {
      // skip malformed lines
    }
  }
  return records;
};

export const readHookLogRecords = (
  file: string,
  maxRecords = DEFAULT_MAX_LOG_RECORDS,
): HookLogReadResult => {
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return { kind: 'invalid' };
    }

    const cached = logRecordsCache.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.value;
    }

    const { rawText, isTruncated } = readTailString(file, stat.size);
    const records = parseLogLineRecords(rawText);
    const trimmed = records.slice(-maxRecords);
    const result: HookLogReadResult = { kind: 'ok', records: trimmed, truncated: isTruncated };
    logRecordsCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, value: result });
    return result;
  } catch (error) {
    logRecordsCache.delete(file);
    return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
      ? { kind: 'missing' }
      : { kind: 'invalid' };
  }
};

export const readSessionLatestLogs = (
  file: string,
  sessionID: string,
): Map<string, HookRunLogRecord> => {
  const map = new Map<string, HookRunLogRecord>();
  if (!sessionID) {
    return map;
  }
  const result = readHookLogRecords(file);
  if (result.kind !== 'ok') {
    return map;
  }
  for (const record of result.records) {
    if (record.sessionID === sessionID) {
      map.set(record.event, record);
    }
  }
  return map;
};

export interface ReadSessionHookLogsOptions {
  readonly file: string;
  readonly event: HookEventName;
  readonly since?: number;
  readonly sessionID?: string;
}

const resolveSessionHookLogArguments = (
  fileOrOptions: string | ReadSessionHookLogsOptions,
  rest: readonly [event?: HookEventName, since?: number, sessionID?: string] | [],
): ReadSessionHookLogsOptions => {
  if (typeof fileOrOptions === 'object') {
    return fileOrOptions;
  }
  const event = rest[0] as HookEventName;
  const since = typeof rest[1] === 'number' ? rest[1] : -Infinity;
  const sessionID = rest[2];
  return { file: fileOrOptions, event, since, sessionID };
};

export const readSessionHookLogs = (
  fileOrOptions: string | ReadSessionHookLogsOptions,
  ...rest: readonly [event?: HookEventName, since?: number, sessionID?: string] | []
): readonly HookRunLogRecord[] => {
  const { file, event, since = -Infinity, sessionID } = resolveSessionHookLogArguments(
    fileOrOptions,
    rest,
  );
  const result = readHookLogRecords(file);
  if (result.kind !== 'ok') {
    return [];
  }
  return result.records.filter((logRecord) => {
    if (logRecord.event !== event) {
      return false;
    }
    const hasSessionId = sessionID !== undefined && sessionID.length > 0;
    const isSessionMismatch =
      hasSessionId && logRecord.sessionID !== sessionID && logRecord.sessionID !== undefined;
    return !isSessionMismatch && logRecord.startedAt >= since;
  });
};
