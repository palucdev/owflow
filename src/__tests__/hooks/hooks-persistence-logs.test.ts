import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_MAX_LOG_RECORDS,
  MAX_LOG_TAIL_READ_BYTES,
  readHookLogRecords,
  readSessionHookLogs,
  readSessionLatestLogs,
} from '../../hooks/hooks-persistence.js';
import { HookEvent, type HookRunLogRecord } from '../../types/hook-types.js';
import {
  cleanupWorkspaces,
  createLogRecord,
  createWorkspace,
  expectOkLogResult,
  writeLogRecords,
  type LogRecordOverrides,
} from './hooks-test-helpers.js';

const BYTES_PER_KILOBYTE = 1024;
const EXPECTED_TAIL_READ_KILOBYTES = 256;
const EXPECTED_DEFAULT_MAX_LOG_RECORDS = 500;
const PADDING_TARGET_KILOBYTES = 260;
const TAIL_RECORD_COUNT = 2;
const CUSTOM_MAX_RECORDS = 1;
const SESSION_LATEST_COUNT = 2;
const SECOND_SESSION_LATEST_COUNT = 1;
const FIRST_STARTED_AT = 12_000;
const FIRST_FINISHED_AT = 12_050;
const SECOND_STARTED_AT = 13_000;
const SECOND_FINISHED_AT = 13_050;
const THIRD_STARTED_AT = 14_000;
const THIRD_FINISHED_AT = 14_050;
const FOURTH_STARTED_AT = 15_000;
const FOURTH_FINISHED_AT = 15_050;
const CONFIG_STARTED_AT = 16_000;
const CONFIG_FINISHED_AT = 16_050;
const SINCE_TIMESTAMP = 12_500;
const FUTURE_FILTER_TIMESTAMP = 20_000;
const RECORD_DURATION_MS = 50;

const expectLatestSessionLogs = (logFile: string, records: readonly HookRunLogRecord[]): void => {
  const [, secondRecord, chatRecord, otherRecord] = records;

  const sessionLogs = readSessionLatestLogs(logFile, 'ses_1');
  expect(sessionLogs.size).toBe(SESSION_LATEST_COUNT);
  expect(sessionLogs.get(HookEvent.ToolExecuteBefore)).toEqual(secondRecord);
  expect(sessionLogs.get(HookEvent.ChatMessage)).toEqual(chatRecord);

  const secondSessionLogs = readSessionLatestLogs(logFile, 'ses_2');
  expect(secondSessionLogs.size).toBe(SECOND_SESSION_LATEST_COUNT);
  expect(secondSessionLogs.get(HookEvent.ToolExecuteBefore)).toEqual(otherRecord);
};

const expectSessionRunLogs = (logFile: string, records: readonly HookRunLogRecord[]): void => {
  const [firstRecord, secondRecord, , otherRecord, configRecord] = records;

  expect(readSessionHookLogs(logFile, HookEvent.ToolExecuteBefore, 0, 'ses_1')).toEqual([firstRecord, secondRecord]);
  expect(readSessionHookLogs(logFile, HookEvent.ToolExecuteBefore, SINCE_TIMESTAMP, 'ses_1')).toEqual([secondRecord]);
  expect(readSessionHookLogs(logFile, HookEvent.ToolExecuteBefore, 0, 'ses_2')).toEqual([otherRecord]);
  expect(readSessionHookLogs(logFile, HookEvent.Config)).toEqual([configRecord]);
  expect(readSessionHookLogs(logFile, HookEvent.Config, FUTURE_FILTER_TIMESTAMP)).toEqual([]);
};

const expectSessionReadResults = (logFile: string, records: readonly HookRunLogRecord[]): void => {
  expectLatestSessionLogs(logFile, records);
  expectSessionRunLogs(logFile, records);
};

const sessionRecord = (workspace: string, overrides: LogRecordOverrides): HookRunLogRecord =>
  createLogRecord({ workspace, durationMs: RECORD_DURATION_MS, ...overrides });

const createSessionRecords = (workspace: string): HookRunLogRecord[] => [
  sessionRecord(workspace, {
    runId: 'tool.execute.before#1',
    sessionID: 'ses_1',
    startedAt: FIRST_STARTED_AT,
    finishedAt: FIRST_FINISHED_AT,
    status: 'failure',
    reason: 'failed run 1',
  }),
  sessionRecord(workspace, {
    runId: 'tool.execute.before#2',
    sessionID: 'ses_1',
    startedAt: SECOND_STARTED_AT,
    finishedAt: SECOND_FINISHED_AT,
  }),
  sessionRecord(workspace, {
    runId: 'chat.message#1',
    event: HookEvent.ChatMessage,
    hook: '/hook2.sh',
    name: 'chat-message',
    sessionID: 'ses_1',
    startedAt: THIRD_STARTED_AT,
    finishedAt: THIRD_FINISHED_AT,
    status: 'failure',
  }),
  sessionRecord(workspace, {
    runId: 'tool.execute.before#3',
    sessionID: 'ses_2',
    startedAt: FOURTH_STARTED_AT,
    finishedAt: FOURTH_FINISHED_AT,
    status: 'failure',
  }),
  sessionRecord(workspace, {
    runId: 'config#1',
    event: HookEvent.Config,
    hook: '/hook3.sh',
    name: 'config',
    startedAt: CONFIG_STARTED_AT,
    finishedAt: CONFIG_FINISHED_AT,
  }),
];

afterEach(cleanupWorkspaces);

describe('readHookLogRecords validation', () => {
  test('readHookLogRecords handles missing, invalid, symlinks, and lines skipping', () => {
    const workspace = createWorkspace('owflow-hook-logs-unit-');
    const logFile = path.join(workspace, 'logs.jsonl');

    expect(readHookLogRecords(logFile)).toEqual({ kind: 'missing' });

    const directoryPath = path.join(workspace, 'log-dir');
    fs.mkdirSync(directoryPath);
    expect(readHookLogRecords(directoryPath)).toEqual({ kind: 'invalid' });

    fs.writeFileSync(logFile, '{bad\n\n  \n');
    expect(readHookLogRecords(logFile)).toEqual({ kind: 'ok', records: [], truncated: false });

    const record = createLogRecord({ workspace, sessionID: 'ses_1' });
    fs.writeFileSync(logFile, `${JSON.stringify(record)}\n`);
    expect(readHookLogRecords(logFile)).toEqual({ kind: 'ok', records: [record], truncated: false });

    const symlinkLog = path.join(workspace, 'sym-log.jsonl');
    fs.symlinkSync(logFile, symlinkLog);
    expect(readHookLogRecords(symlinkLog)).toEqual({ kind: 'invalid' });
  });

  test('readHookLogRecords returns cached results when mtime and size are unchanged', () => {
    const workspace = createWorkspace('owflow-hook-logs-unit-');
    const logFile = path.join(workspace, 'cached-log.jsonl');
    writeLogRecords(logFile, [createLogRecord({ workspace })]);

    const firstRead = readHookLogRecords(logFile);
    const secondRead = readHookLogRecords(logFile);
    expect(firstRead).toBe(secondRead);
  });
});

describe('session log readers', () => {
  test('readSessionLatestLogs and readSessionHookLogs support session and event log retrieval', () => {
    const workspace = createWorkspace('owflow-hook-logs-unit-');
    const logFile = path.join(workspace, 'test-logs.jsonl');

    expect(readSessionLatestLogs(logFile, 'ses_1')).toEqual(new Map());
    expect(readSessionLatestLogs(logFile, '')).toEqual(new Map());
    expect(readSessionHookLogs(logFile, HookEvent.ToolExecuteBefore)).toEqual([]);

    const records = createSessionRecords(workspace);
    writeLogRecords(logFile, records);
    expectSessionReadResults(logFile, records);
  });
});

interface LargeTailLog {
  readonly filePath: string;
  readonly trailingRecords: readonly HookRunLogRecord[];
}

const createLargeTailLog = (workspace: string): LargeTailLog => {
  const filePath = path.join(workspace, 'large-tail.jsonl');
  const oldRecord = createLogRecord({ workspace, runId: 'tool.execute.before#old' });
  const oldLine = `${JSON.stringify(oldRecord)}\n`;
  const padding = oldLine.repeat(Math.ceil((PADDING_TARGET_KILOBYTES * BYTES_PER_KILOBYTE) / oldLine.length));
  const splitLineFragment = '{"version":1,"event":"truncated-before-slice"';
  const trailingRecords = [
    createLogRecord({ workspace, runId: 'tool.execute.before#tail1' }),
    createLogRecord({ workspace, runId: 'tool.execute.before#tail2' }),
  ];
  fs.writeFileSync(filePath, `${padding + splitLineFragment}\n${trailingRecords.map((record) => JSON.stringify(record)).join('\n')}\n`);
  return { filePath, trailingRecords };
};

describe('readHookLogRecords tail slicing', () => {
  test('readHookLogRecords bounds read to 256KB tail slice, sets truncated, and drops leading partial line', () => {
    const workspace = createWorkspace('owflow-hook-logs-unit-');
    const logFile = path.join(workspace, 'tail-test.jsonl');

    expect(DEFAULT_MAX_LOG_RECORDS).toBe(EXPECTED_DEFAULT_MAX_LOG_RECORDS);
    expect(MAX_LOG_TAIL_READ_BYTES).toBe(EXPECTED_TAIL_READ_KILOBYTES * BYTES_PER_KILOBYTE);

    fs.writeFileSync(logFile, '');
    expect(readHookLogRecords(logFile)).toEqual({ kind: 'ok', records: [], truncated: false });

    const firstRecord = createLogRecord({ workspace, runId: 'tool.execute.before#1' });
    const secondRecord = createLogRecord({ workspace, runId: 'tool.execute.before#2' });
    writeLogRecords(logFile, [firstRecord, secondRecord]);
    expect(readHookLogRecords(logFile)).toEqual({ kind: 'ok', records: [firstRecord, secondRecord], truncated: false });

    const largeTailLog = createLargeTailLog(workspace);
    expect(fs.statSync(largeTailLog.filePath).size).toBeGreaterThan(MAX_LOG_TAIL_READ_BYTES);

    const largeResult = expectOkLogResult(readHookLogRecords(largeTailLog.filePath));
    expect(largeResult.truncated).toBe(true);
    expect(largeResult.records.slice(-TAIL_RECORD_COUNT)).toEqual(largeTailLog.trailingRecords);

    const customMaxFile = path.join(workspace, 'custom-max.jsonl');
    writeLogRecords(customMaxFile, [firstRecord, secondRecord]);
    const trimmedResult = expectOkLogResult(readHookLogRecords(customMaxFile, CUSTOM_MAX_RECORDS));
    expect(trimmedResult.records).toHaveLength(1);
    expect(trimmedResult.records[0]).toEqual(secondRecord);
  });
});
