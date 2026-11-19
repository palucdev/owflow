import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_MAX_LOG_RECORDS,
  MAX_LOG_TAIL_READ_BYTES,
  readHookLogRecords,
  readHookStatusSnapshot,
  readSessionHookLogs,
  readSessionLatestLogs,
} from '../../hooks/hooks-log-reader.js';
import { HookEvent, HookRunState, type HookRunLogRecord, type HookStatusSnapshot } from '../../types/hook-types.js';
import { removeScratchDirectory } from '../fixtures/hooks/scratch-cleanup.js';

const EXPECTED_MAX_LOG_TAIL_READ_BYTES = 262_144;
const EXPECTED_DEFAULT_MAX_LOG_RECORDS = 500;
const SINCE_OFFSET_MS = 1500;
const FAR_FUTURE_TIMESTAMP_MS = 10_000;
const EXPECTED_SES1_LATEST_COUNT = 2;
const NULL_VALUE: null = JSON.parse('null');
const PADDING_KILOBYTES = 260;
const BYTES_PER_KILOBYTE = 1024;
const CUSTOM_MAX_RECORDS = 1;
const TAIL_RECORD_COUNT = 2;
const SCRATCH_ROOT = path.join(process.cwd(), '.test-scratch', 'hooks-log-reader');

const makeRecord = (overrides: Partial<HookRunLogRecord> = {}): HookRunLogRecord => ({
  version: 1,
  runId: 'tool.execute.before#1',
  pid: 1,
  workspace: '/workspace',
  event: HookEvent.ToolExecuteBefore,
  hook: '/hook1.sh',
  name: 'tool-execute-before',
  sessionID: 'ses_1',
  startedAt: 1000,
  finishedAt: 1050,
  durationMs: 50,
  status: HookRunState.SUCCESS,
  ...overrides,
});

interface SessionFixture {
  records: HookRunLogRecord[];
  recordA1: HookRunLogRecord;
  recordA2: HookRunLogRecord;
  recordB1: HookRunLogRecord;
  recordOther: HookRunLogRecord;
  recordNoSession: HookRunLogRecord;
}

const buildSessionFixture = (root: string): SessionFixture => {
  const recordA1 = makeRecord({ workspace: root, runId: 'tool.execute.before#1' });
  const recordA2 = makeRecord({ workspace: root, runId: 'tool.execute.before#2', startedAt: 2000, finishedAt: 2050 });
  const recordB1 = makeRecord({
    workspace: root,
    runId: 'chat.message#1',
    event: HookEvent.ChatMessage,
    hook: '/hook2.sh',
    name: 'chat-message',
    startedAt: 2500,
    finishedAt: 2550,
    status: HookRunState.FAILURE,
  });
  const recordOther = makeRecord({
    workspace: root,
    runId: 'tool.execute.before#3',
    sessionID: 'ses_2',
    startedAt: 3000,
    finishedAt: 3050,
    status: HookRunState.FAILURE,
  });
  const recordNoSession = makeRecord({
    workspace: root,
    runId: 'config#1',
    event: HookEvent.Config,
    hook: '/hook3.sh',
    name: 'config',
    sessionID: undefined,
    startedAt: 4000,
    finishedAt: 4050,
  });
  return {
    records: [recordA1, recordA2, recordB1, recordOther, recordNoSession],
    recordA1,
    recordA2,
    recordB1,
    recordOther,
    recordNoSession,
  };
};

fs.rmSync(SCRATCH_ROOT, { recursive: true, force: true });
fs.mkdirSync(SCRATCH_ROOT, { recursive: true });

afterAll(() => {
  removeScratchDirectory(SCRATCH_ROOT);
});

describe('hooks-log-reader (documented constants)', () => {
  test('exports the documented reader constants', () => {
    expect(MAX_LOG_TAIL_READ_BYTES).toBe(EXPECTED_MAX_LOG_TAIL_READ_BYTES);
    expect(DEFAULT_MAX_LOG_RECORDS).toBe(EXPECTED_DEFAULT_MAX_LOG_RECORDS);
  });
});

describe('hooks-log-reader (status snapshot)', () => {
  test('readHookStatusSnapshot handles missing, invalid, symlinks, directories, and valid files', () => {
    const root = path.join(SCRATCH_ROOT, 'status-snapshot');
    fs.mkdirSync(root, { recursive: true });
    const statusFile = path.join(root, 'status.json');

    // Missing
    expect(readHookStatusSnapshot(statusFile)).toEqual({ kind: 'missing' });

    // Directory
    fs.mkdirSync(path.join(root, 'status-dir'));
    expect(readHookStatusSnapshot(path.join(root, 'status-dir'))).toEqual({ kind: 'invalid' });

    // Corrupt JSON
    fs.writeFileSync(statusFile, '{bad');
    expect(readHookStatusSnapshot(statusFile)).toEqual({ kind: 'invalid' });

    // Invalid schema: version !== 1
    fs.writeFileSync(statusFile, JSON.stringify({ version: 2, hooks: {} }));
    expect(readHookStatusSnapshot(statusFile)).toEqual({ kind: 'invalid' });

    // Invalid schema: hooks is null or not an object
    fs.writeFileSync(statusFile, JSON.stringify({ version: 1, hooks: NULL_VALUE }));
    expect(readHookStatusSnapshot(statusFile)).toEqual({ kind: 'invalid' });
    fs.writeFileSync(statusFile, JSON.stringify({ version: 1, hooks: 'bad' }));
    expect(readHookStatusSnapshot(statusFile)).toEqual({ kind: 'invalid' });

    // Valid
    const validSnapshot: HookStatusSnapshot = {
      version: 1,
      pid: 1234,
      workspace: root,
      updatedAt: 1000,
      hooks: {},
    };
    fs.writeFileSync(statusFile, JSON.stringify(validSnapshot));
    expect(readHookStatusSnapshot(statusFile)).toEqual({ kind: 'ok', snapshot: validSnapshot });

    // Symlink
    fs.symlinkSync(statusFile, path.join(root, 'sym-status.json'));
    expect(readHookStatusSnapshot(path.join(root, 'sym-status.json'))).toEqual({ kind: 'invalid' });
  });
});

describe('hooks-log-reader (log records)', () => {
  test('readHookLogRecords handles missing, invalid, symlinks, and lines skipping', () => {
    const root = path.join(SCRATCH_ROOT, 'log-records');
    fs.mkdirSync(root, { recursive: true });
    const logFile = path.join(root, 'logs.jsonl');

    // Missing
    expect(readHookLogRecords(logFile)).toEqual({ kind: 'missing' });

    // Directory
    const directoryPath = path.join(root, 'log-dir');
    fs.mkdirSync(directoryPath);
    expect(readHookLogRecords(directoryPath)).toEqual({ kind: 'invalid' });

    // Malformed JSON and empty lines
    fs.writeFileSync(logFile, '{bad\n\n  \n');
    expect(readHookLogRecords(logFile)).toEqual({ kind: 'ok', records: [], truncated: false });

    // Valid records
    const record = makeRecord({ workspace: root });
    fs.writeFileSync(logFile, `${JSON.stringify(record)}\n`);
    expect(readHookLogRecords(logFile)).toEqual({ kind: 'ok', records: [record], truncated: false });

    // Symlink
    const symLog = path.join(root, 'sym-log.jsonl');
    fs.symlinkSync(logFile, symLog);
    expect(readHookLogRecords(symLog)).toEqual({ kind: 'invalid' });
  });
});

describe('hooks-log-reader (session retrieval)', () => {
  test('readSessionLatestLogs returns the latest record per event for a session', () => {
    const root = path.join(SCRATCH_ROOT, 'latest-per-event');
    fs.mkdirSync(root, { recursive: true });
    const logFile = path.join(root, 'test-logs.jsonl');
    const fixture = buildSessionFixture(root);
    fs.writeFileSync(logFile, fixture.records.map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');

    // readSessionLatestLogs returns latest record per event for ses_1
    const ses1Logs = readSessionLatestLogs(logFile, 'ses_1');
    expect(ses1Logs.size).toBe(EXPECTED_SES1_LATEST_COUNT);
    expect(ses1Logs.get(HookEvent.ToolExecuteBefore)).toEqual(fixture.recordA2);
    expect(ses1Logs.get(HookEvent.ChatMessage)).toEqual(fixture.recordB1);

    // ses_2 only has recordOther
    const ses2Logs = readSessionLatestLogs(logFile, 'ses_2');
    expect(ses2Logs.size).toBe(1);
    expect(ses2Logs.get(HookEvent.ToolExecuteBefore)).toEqual(fixture.recordOther);
  });

  test('readSessionHookLogs filters by session, event, and since, and returns all matching records', () => {
    const root = path.join(SCRATCH_ROOT, 'session-filters');
    fs.mkdirSync(root, { recursive: true });
    const logFile = path.join(root, 'session-logs.jsonl');
    const fixture = buildSessionFixture(root);
    fs.writeFileSync(logFile, fixture.records.map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');

    expect(readSessionHookLogs(logFile, HookEvent.ToolExecuteBefore, 0, 'ses_1')).toEqual([fixture.recordA1, fixture.recordA2]);
    // since filter must be respected even when sessionID matches
    expect(readSessionHookLogs(logFile, HookEvent.ToolExecuteBefore, SINCE_OFFSET_MS, 'ses_1')).toEqual([fixture.recordA2]);
    expect(readSessionHookLogs(logFile, HookEvent.ToolExecuteBefore, 0, 'ses_2')).toEqual([fixture.recordOther]);
    expect(readSessionHookLogs(logFile, HookEvent.Config)).toEqual([fixture.recordNoSession]);
    expect(readSessionHookLogs(logFile, HookEvent.Config, FAR_FUTURE_TIMESTAMP_MS)).toEqual([]);
  });

  test('readSessionLatestLogs and readSessionHookLogs handle missing or invalid files', () => {
    const root = path.join(SCRATCH_ROOT, 'missing-invalid');
    const logFile = path.join(root, 'missing.jsonl');

    expect(readSessionLatestLogs(logFile, 'ses_1')).toEqual(new Map());
    expect(readSessionLatestLogs(logFile, '')).toEqual(new Map());
    expect(readSessionHookLogs(logFile, HookEvent.ToolExecuteBefore)).toEqual([]);
  });
});

describe('hooks-log-reader (caching)', () => {
  test('readHookLogRecords and readHookStatusSnapshot return cached results when mtime and size are unchanged', () => {
    const root = path.join(SCRATCH_ROOT, 'caching');
    fs.mkdirSync(root, { recursive: true });
    const logFile = path.join(root, 'cached-log.jsonl');
    const record = makeRecord({ workspace: root, hook: '/hook.sh' });
    fs.writeFileSync(logFile, `${JSON.stringify(record)}\n`);

    const firstRead = readHookLogRecords(logFile);
    const secondRead = readHookLogRecords(logFile);
    expect(firstRead).toBe(secondRead);

    const statusFile = path.join(root, 'cached-status.json');
    fs.writeFileSync(statusFile, JSON.stringify({ version: 1, pid: 1, workspace: root, updatedAt: 100, hooks: {} }));
    const firstStatus = readHookStatusSnapshot(statusFile);
    const secondStatus = readHookStatusSnapshot(statusFile);
    expect(firstStatus).toBe(secondStatus);
  });
});

describe('hooks-log-reader (tail slice)', () => {
  test('readHookLogRecords returns empty and small non-truncated files unchanged', () => {
    const root = path.join(SCRATCH_ROOT, 'small-files');
    fs.mkdirSync(root, { recursive: true });
    const logFile = path.join(root, 'tail-test.jsonl');

    // Empty file
    fs.writeFileSync(logFile, '');
    expect(readHookLogRecords(logFile)).toEqual({ kind: 'ok', records: [], truncated: false });

    // File smaller than MAX_LOG_TAIL_READ_BYTES
    const recordA = makeRecord({ workspace: root });
    const recordB = makeRecord({ workspace: root, runId: 'tool.execute.before#2', startedAt: 2000, finishedAt: 2050 });
    fs.writeFileSync(logFile, `${JSON.stringify(recordA)}\n${JSON.stringify(recordB)}\n`);
    expect(readHookLogRecords(logFile)).toEqual({ kind: 'ok', records: [recordA, recordB], truncated: false });
  });

  test('readHookLogRecords bounds reads to the max tail slice and drops a leading partial line', () => {
    const root = path.join(SCRATCH_ROOT, 'large-tail');
    fs.mkdirSync(root, { recursive: true });
    const largeLogFile = path.join(root, 'large-tail.jsonl');
    const oldRecord = makeRecord({ workspace: root, runId: 'tool.execute.before#old', startedAt: 500, finishedAt: 550 });
    const oldLine = JSON.stringify(oldRecord) + '\n';
    const padding = oldLine.repeat(Math.ceil((PADDING_KILOBYTES * BYTES_PER_KILOBYTE) / oldLine.length));
    const splitLineFragment = '{"version":1,"event":"truncated-before-slice"';
    const trailingRecord1 = makeRecord({ workspace: root, runId: 'tool.execute.before#tail1', startedAt: 10_000, finishedAt: 10_050 });
    const trailingRecord2 = makeRecord({ workspace: root, runId: 'tool.execute.before#tail2', startedAt: 11_000, finishedAt: 11_050 });
    fs.writeFileSync(
      largeLogFile,
      padding + splitLineFragment + '\n' + JSON.stringify(trailingRecord1) + '\n' + JSON.stringify(trailingRecord2) + '\n',
    );

    const largeStat = fs.statSync(largeLogFile);
    expect(largeStat.size).toBeGreaterThan(MAX_LOG_TAIL_READ_BYTES);

    const largeResult = readHookLogRecords(largeLogFile);
    expect(largeResult.kind).toBe('ok');
    if (largeResult.kind !== 'ok') throw new Error('unreachable');
    expect(largeResult.truncated).toBe(true);
    expect(largeResult.records.slice(-TAIL_RECORD_COUNT)).toEqual([trailingRecord1, trailingRecord2]);
  });

  test('readHookLogRecords trims output to a custom maxRecords count', () => {
    const root = path.join(SCRATCH_ROOT, 'custom-max');
    fs.mkdirSync(root, { recursive: true });
    const customMaxFile = path.join(root, 'custom-max.jsonl');
    const recordA = makeRecord({ workspace: root });
    const recordB = makeRecord({ workspace: root, runId: 'tool.execute.before#2', startedAt: 2000, finishedAt: 2050 });
    fs.writeFileSync(customMaxFile, `${JSON.stringify(recordA)}\n${JSON.stringify(recordB)}\n`);

    const trimmedResult = readHookLogRecords(customMaxFile, CUSTOM_MAX_RECORDS);
    expect(trimmedResult.kind).toBe('ok');
    if (trimmedResult.kind !== 'ok') throw new Error('unreachable');
    expect(trimmedResult.records).toHaveLength(CUSTOM_MAX_RECORDS);
    expect(trimmedResult.records[0]).toEqual(recordB);
  });
});
