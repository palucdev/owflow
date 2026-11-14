import { HookRunState, type HookRunLogRecord, type HookRuntimeEntry } from '../types/hook-types.js';
import type { ActiveHookRow } from './hooks-presenter.js';
import { readHookStatusSnapshot, readSessionHookLogs } from '../hooks/hooks-persistence.js';

export interface ResolveSessionRecordsOptions {
  readonly logFile: string;
  readonly row: ActiveHookRow;
  readonly notBefore: number;
  readonly sessionID?: string;
  readonly statusFile?: string;
  readonly fallbackEntry?: HookRuntimeEntry;
}

export const createIdleRecord = (row: ActiveHookRow, sessionID?: string): HookRunLogRecord => ({
  version: 1,
  runId: `${row.event}#idle`,
  pid: process.pid,
  workspace: '',
  event: row.event,
  hook: row.name,
  name: row.name,
  ...(sessionID !== undefined && { sessionID }),
  startedAt: 0,
  finishedAt: 0,
  durationMs: 0,
  status: HookRunState.IDLE,
});

const resolveOptions = (
  fileOrOptions: string | ResolveSessionRecordsOptions,
  rest: readonly unknown[],
): ResolveSessionRecordsOptions => {
  if (typeof fileOrOptions === 'object') {
    return fileOrOptions;
  }
  const row = rest[0] as ActiveHookRow;
  const notBefore = typeof rest[1] === 'number' ? rest[1] : 0;
  const sessionID = typeof rest[2] === 'string' ? rest[2] : undefined;
  const statusFile = typeof rest[3] === 'string' ? rest[3] : undefined;
  const fallbackEntry = rest[4] as HookRuntimeEntry | undefined;
  return { logFile: fileOrOptions, row, notBefore, sessionID, statusFile, fallbackEntry };
};

const resolveStatusEntry = (
  statusFile: string | undefined,
  context: { readonly eventName: string; readonly fallbackEntry?: HookRuntimeEntry },
): HookRuntimeEntry | undefined => {
  if (!statusFile) {
    return context.fallbackEntry;
  }
  try {
    const snap = readHookStatusSnapshot(statusFile);
    if (snap.kind === 'ok' && Object.prototype.hasOwnProperty.call(snap.snapshot.hooks, context.eventName)) {
      return snap.snapshot.hooks[context.eventName];
    }
  } catch {
    // ignore status file read errors
  }
  return context.fallbackEntry;
};

const buildActiveRuntimeRecord = (
  row: ActiveHookRow,
  context: { readonly entry: HookRuntimeEntry; readonly sessionID?: string },
): HookRunLogRecord => {
  const { entry, sessionID } = context;
  const now = Date.now();
  const exitCode = (entry as { readonly exitCode?: number | null }).exitCode;
  const resolvedSessionID = entry.sessionID ?? sessionID;
  return {
    version: 1,
    runId: `${row.event}#${entry.status}`,
    pid: process.pid,
    workspace: '',
    event: row.event,
    hook: row.name,
    name: row.name,
    ...(resolvedSessionID !== undefined && { sessionID: resolvedSessionID }),
    startedAt: entry.startedAt,
    finishedAt: entry.finishedAt ?? now,
    durationMs: entry.durationMs ?? Math.max(0, (entry.finishedAt ?? now) - entry.startedAt),
    status: entry.status,
    ...(exitCode !== undefined && { exitCode }),
    ...(entry.reason !== undefined && { reason: entry.reason }),
  };
};

const shouldAppendEntryRecord = (
  entry: HookRuntimeEntry,
  context: { readonly records: readonly HookRunLogRecord[]; readonly sessionID?: string },
): boolean => {
  const { records, sessionID } = context;
  const doesBelong = !sessionID || !entry.sessionID || entry.sessionID === sessionID;
  if (!doesBelong) {
    return false;
  }
  const lastRecord = records.at(-1);
  return entry.status === HookRunState.PENDING
    ? lastRecord?.status !== HookRunState.PENDING
    : lastRecord === undefined || lastRecord.startedAt < entry.startedAt;
};

export const resolveSessionRecords = (
  fileOrOptions: string | ResolveSessionRecordsOptions,
  ...rest: readonly unknown[]
): readonly HookRunLogRecord[] => {
  const { logFile, row, notBefore, sessionID, statusFile, fallbackEntry } = resolveOptions(
    fileOrOptions,
    rest,
  );

  let records: readonly HookRunLogRecord[] = [];
  try {
    records = readSessionHookLogs(logFile, row.event, notBefore, sessionID);
  } catch {
    // ignore session hook logs read errors
  }

  const entry = resolveStatusEntry(statusFile, { eventName: row.event, fallbackEntry });
  if (entry && entry.status !== HookRunState.IDLE && shouldAppendEntryRecord(entry, { records, sessionID })) {
    const runtimeRecord = buildActiveRuntimeRecord(row, { entry, sessionID });
    records = [...records, runtimeRecord];
  }

  return records;
};
