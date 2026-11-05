import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  LOG_FILE_ENV,
  readHookLogRecords,
  readHookStatusSnapshot,
  readLatestHookLog,
  readSessionHookLogs,
  readSessionLatestLogs,
  resolveHooksLogFile,
  resolveHooksStatusFile,
  STATUS_FILE_ENV,
  type HookRunLogRecord,
} from '../../hooks/hooks-logs.js';
import { HookEvent } from '../../types/hook-types.js';

describe('hook-logs (status and log file readers and resolvers)', () => {
  const tempDirs: string[] = [];

  const makeTempDir = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owflow-hook-logs-unit-'));
    tempDirs.push(dir);
    return dir;
  };

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('resolveHooksStatusFile and resolveHooksLogFile resolve default and env-overridden paths', () => {
    const root = makeTempDir();
    expect(resolveHooksStatusFile(root)).toContain('owflow-hooks-');
    expect(resolveHooksLogFile(root)).toContain('owflow-hook-logs-');

    // Non-existent workspace still resolves
    const nonExistent = path.join(root, 'does-not-exist');
    expect(resolveHooksStatusFile(nonExistent)).toContain('owflow-hooks-');
    expect(resolveHooksLogFile(nonExistent)).toContain('owflow-hook-logs-');

    const prevStatus = process.env[STATUS_FILE_ENV];
    const prevLog = process.env[LOG_FILE_ENV];
    process.env[STATUS_FILE_ENV] = '/tmp/override-status.json';
    process.env[LOG_FILE_ENV] = '/tmp/override-log.jsonl';
    try {
      expect(resolveHooksStatusFile(root)).toBe('/tmp/override-status.json');
      expect(resolveHooksLogFile(root)).toBe('/tmp/override-log.jsonl');
    } finally {
      if (prevStatus === undefined) delete process.env[STATUS_FILE_ENV];
      else process.env[STATUS_FILE_ENV] = prevStatus;
      if (prevLog === undefined) delete process.env[LOG_FILE_ENV];
      else process.env[LOG_FILE_ENV] = prevLog;
    }
  });

  test('readHookStatusSnapshot handles missing, invalid, symlinks, directories, and valid files', () => {
    const root = makeTempDir();
    const statusFile = path.join(root, 'status.json');

    // Missing
    expect(readHookStatusSnapshot(statusFile)).toEqual({ kind: 'missing' });

    // Directory
    const dirPath = path.join(root, 'status-dir');
    fs.mkdirSync(dirPath);
    expect(readHookStatusSnapshot(dirPath)).toEqual({ kind: 'invalid' });

    // Corrupt JSON
    fs.writeFileSync(statusFile, '{bad');
    expect(readHookStatusSnapshot(statusFile)).toEqual({ kind: 'invalid' });

    // Invalid schema: version !== 1
    fs.writeFileSync(statusFile, JSON.stringify({ version: 2, hooks: {} }));
    expect(readHookStatusSnapshot(statusFile)).toEqual({ kind: 'invalid' });

    // Invalid schema: hooks is null or not an object
    fs.writeFileSync(statusFile, JSON.stringify({ version: 1, hooks: null }));
    expect(readHookStatusSnapshot(statusFile)).toEqual({ kind: 'invalid' });
    fs.writeFileSync(statusFile, JSON.stringify({ version: 1, hooks: 'bad' }));
    expect(readHookStatusSnapshot(statusFile)).toEqual({ kind: 'invalid' });

    // Valid
    const validSnapshot = {
      version: 1,
      pid: 1234,
      workspace: root,
      updatedAt: 1_000,
      hooks: {},
    };
    fs.writeFileSync(statusFile, JSON.stringify(validSnapshot));
    expect(readHookStatusSnapshot(statusFile)).toEqual({ kind: 'ok', snapshot: validSnapshot as any });

    // Symlink
    const symStatus = path.join(root, 'sym-status.json');
    fs.symlinkSync(statusFile, symStatus);
    expect(readHookStatusSnapshot(symStatus)).toEqual({ kind: 'invalid' });
  });

  test('readHookLogRecords handles missing, invalid, symlinks, and lines skipping', () => {
    const root = makeTempDir();
    const logFile = path.join(root, 'logs.jsonl');

    // Missing
    expect(readHookLogRecords(logFile)).toEqual({ kind: 'missing' });

    // Directory
    const dirPath = path.join(root, 'log-dir');
    fs.mkdirSync(dirPath);
    expect(readHookLogRecords(dirPath)).toEqual({ kind: 'invalid' });

    // Malformed JSON and empty lines
    fs.writeFileSync(logFile, '{bad\n\n  \n');
    expect(readHookLogRecords(logFile)).toEqual({ kind: 'ok', records: [], truncated: false });

    // Valid records
    const record = {
      version: 1,
      runId: 'tool.execute.before#1',
      pid: 1,
      workspace: root,
      event: HookEvent.ToolExecuteBefore,
      hook: '/hook1.sh',
      name: 'tool-execute-before',
      sessionID: 'ses_1',
      startedAt: 1_000,
      finishedAt: 1_050,
      durationMs: 50,
      status: 'success' as const,
    };
    fs.writeFileSync(logFile, `${JSON.stringify(record)}\n`);
    expect(readHookLogRecords(logFile)).toEqual({ kind: 'ok', records: [record as HookRunLogRecord], truncated: false });

    // Symlink
    const symLog = path.join(root, 'sym-log.jsonl');
    fs.symlinkSync(logFile, symLog);
    expect(readHookLogRecords(symLog)).toEqual({ kind: 'invalid' });
  });

  test('readSessionLatestLogs, readLatestHookLog, and readSessionHookLogs support session and event log retrieval', () => {
    const root = makeTempDir();
    const logFile = path.join(root, 'test-logs.jsonl');

    // Missing or invalid file
    expect(readSessionLatestLogs(logFile, 'ses_1')).toEqual(new Map());
    expect(readSessionLatestLogs(logFile, '')).toEqual(new Map());
    expect(readSessionHookLogs(logFile, HookEvent.ToolExecuteBefore)).toEqual([]);

    const recordA1 = {
      version: 1,
      runId: 'tool.execute.before#1',
      pid: 1,
      workspace: root,
      event: HookEvent.ToolExecuteBefore,
      hook: '/hook1.sh',
      name: 'tool-execute-before',
      sessionID: 'ses_1',
      startedAt: 1_000,
      finishedAt: 1_050,
      durationMs: 50,
      status: 'failure' as const,
      reason: 'failed run 1',
    };
    const recordA2 = {
      version: 1,
      runId: 'tool.execute.before#2',
      pid: 1,
      workspace: root,
      event: HookEvent.ToolExecuteBefore,
      hook: '/hook1.sh',
      name: 'tool-execute-before',
      sessionID: 'ses_1',
      startedAt: 2_000,
      finishedAt: 2_050,
      durationMs: 50,
      status: 'success' as const,
    };
    const recordB1 = {
      version: 1,
      runId: 'chat.message#1',
      pid: 1,
      workspace: root,
      event: HookEvent.ChatMessage,
      hook: '/hook2.sh',
      name: 'chat-message',
      sessionID: 'ses_1',
      startedAt: 2_500,
      finishedAt: 2_550,
      durationMs: 50,
      status: 'failure' as const,
    };
    const recordOther = {
      version: 1,
      runId: 'tool.execute.before#3',
      pid: 1,
      workspace: root,
      event: HookEvent.ToolExecuteBefore,
      hook: '/hook1.sh',
      name: 'tool-execute-before',
      sessionID: 'ses_2',
      startedAt: 3_000,
      finishedAt: 3_050,
      durationMs: 50,
      status: 'failure' as const,
    };
    const recordNoSession = {
      version: 1,
      runId: 'config#1',
      pid: 1,
      workspace: root,
      event: HookEvent.Config,
      hook: '/hook3.sh',
      name: 'config',
      startedAt: 4_000,
      finishedAt: 4_050,
      durationMs: 50,
      status: 'success' as const,
    };

    fs.writeFileSync(logFile, [recordA1, recordA2, recordB1, recordOther, recordNoSession].map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

    // readSessionLatestLogs returns latest record per event for ses_1
    const ses1Logs = readSessionLatestLogs(logFile, 'ses_1');
    expect(ses1Logs.size).toBe(2);
    expect(ses1Logs.get(HookEvent.ToolExecuteBefore)).toEqual(recordA2 as HookRunLogRecord);
    expect(ses1Logs.get(HookEvent.ChatMessage)).toEqual(recordB1 as HookRunLogRecord);

    // ses_2 only has recordOther
    const ses2Logs = readSessionLatestLogs(logFile, 'ses_2');
    expect(ses2Logs.size).toBe(1);
    expect(ses2Logs.get(HookEvent.ToolExecuteBefore)).toEqual(recordOther as HookRunLogRecord);

    // readLatestHookLog with sessionID
    expect(readLatestHookLog(logFile, HookEvent.ToolExecuteBefore, 5_000, 'ses_1')).toEqual(recordA2 as HookRunLogRecord);
    expect(readLatestHookLog(logFile, HookEvent.ToolExecuteBefore, 5_000, 'ses_2')).toEqual(recordOther as HookRunLogRecord);
    expect(readLatestHookLog(logFile, HookEvent.ChatMessage, 5_000, 'ses_2')).toBeUndefined();

    // readLatestHookLog without sessionID
    expect(readLatestHookLog(logFile, HookEvent.Config)).toEqual(recordNoSession as HookRunLogRecord);
    expect(readLatestHookLog(logFile, HookEvent.Config, 10_000)).toBeUndefined();

    // readSessionHookLogs returns all records for that session event
    const ses1ToolLogs = readSessionHookLogs(logFile, HookEvent.ToolExecuteBefore, 0, 'ses_1');
    expect(ses1ToolLogs).toEqual([recordA1, recordA2] as HookRunLogRecord[]);
    const ses2ToolLogs = readSessionHookLogs(logFile, HookEvent.ToolExecuteBefore, 0, 'ses_2');
    expect(ses2ToolLogs).toEqual([recordOther] as HookRunLogRecord[]);
  });
});
