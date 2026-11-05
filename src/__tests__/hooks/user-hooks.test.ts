import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildReportRows,
  buildStdinPayload,
  createDispatchHandlers,
  DISPATCHABLE_EVENTS,
  EFFECTIVE_AFTER_RESTART,
  EXCLUDED_EVENT_NAMES,
  HOOK_EVENT_NAMES,
  HOOK_TIMEOUT_ENV,
  HookDigestMode,
  HookEvent,
  HOST_EVENT_NAMES,
  initializeHooksWrapper,
  LOG_FILE_ENV,
  MAX_CAPTURE_BYTES,
  MAX_LOG_FILE_BYTES,
  readHookLogRecords,
  readHookStatusSnapshot,
  readLatestHookLog,
  readSessionHookLogs,
  readSessionLatestLogs,
  renderJson,
  renderSnapshot,
  renderTable,
  resolveHooksLogFile,
  resolveHooksStatusFile,
  scanHooks,
  STATUS_FILE_ENV,
  TABLE_COLUMNS,
  type HookRunLogRecord,
} from '../../hooks/user-hooks.js';

describe('user-hooks (consolidated user-hooks engine)', () => {
  const tempDirs: string[] = [];

  const makeTempDir = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owflow-hooks-unit-'));
    tempDirs.push(dir);
    return dir;
  };

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('event tables pin 16 lifecycle events, 32 host events, and 5 excluded names', () => {
    expect(DISPATCHABLE_EVENTS).toHaveLength(16);
    expect(HOST_EVENT_NAMES).toHaveLength(32);
    expect(HOOK_EVENT_NAMES).toHaveLength(48);
    expect(EXCLUDED_EVENT_NAMES).toEqual(['permission.ask', 'tool', 'auth', 'provider', 'experimental.provider.small_model']);
  });

  test('scanHooks validates directory, stems, extensions, duplicates, and interpreter availability', () => {
    const root = makeTempDir();
    const missing = path.join(root, 'absent');
    expect(scanHooks(missing)).toEqual({ entries: [], failures: [] });

    const notDir = path.join(root, 'file-anchor');
    fs.writeFileSync(notDir, 'x');
    expect(() => scanHooks(notDir)).toThrow(/not a directory/);
    expect(scanHooks(notDir, { mode: HookDigestMode.Report }).failures).toHaveLength(1);

    const hooksDir = path.join(root, '.owflow', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'tool-execute-before.sh'), '');
    fs.writeFileSync(path.join(hooksDir, 'session-idle.ps1'), '');

    const valid = scanHooks(hooksDir, {
      which: (cmd) => (cmd === 'bash' ? '/bin/bash' : null),
    });
    expect(valid.failures).toEqual([]);
    expect(valid.entries).toEqual([
      {
        path: path.join(hooksDir, 'session-idle.ps1'),
        event: 'session.idle',
        interpreter: { expected: 'pwsh', available: false },
        status: 'will-fail-closed',
      },
      {
        path: path.join(hooksDir, 'tool-execute-before.sh'),
        event: 'tool.execute.before',
        interpreter: { expected: 'bash', available: true, resolved: '/bin/bash' },
        status: 'registered',
      },
    ]);

    // Add invalid files: directory, bad ext, bad stem, excluded, unknown, duplicate
    fs.mkdirSync(path.join(hooksDir, 'subdir'));
    fs.writeFileSync(path.join(hooksDir, 'readme.md'), '');
    fs.writeFileSync(path.join(hooksDir, 'Bad_Name.sh'), '');
    fs.writeFileSync(path.join(hooksDir, 'permission-ask.sh'), '');
    fs.writeFileSync(path.join(hooksDir, 'unknown-event.sh'), '');
    fs.writeFileSync(path.join(hooksDir, 'tool-execute-before.ps1'), '');

    expect(() => scanHooks(hooksDir)).toThrow(/invalid entries/);
    const report = scanHooks(hooksDir, { mode: HookDigestMode.Report });
    expect(report.entries.map((e) => e.event)).toEqual(['session.idle']);
    expect(report.failures.length).toBe(7);
  });

  test('renderTable, renderSnapshot, and renderJson format rows consistently', () => {
    const input = {
      entries: [
        {
          path: '/p/config.sh',
          event: HookEvent.Config,
          interpreter: { expected: 'bash', resolved: '/bin/bash', available: true },
          status: 'registered' as const,
        },
        {
          path: '/p/dispose.ps1',
          event: HookEvent.Dispose,
          interpreter: { expected: 'pwsh', available: false },
          status: 'will-fail-closed' as const,
        },
      ],
      failures: [{ path: '/p/bad.ts', error: 'not routable' }],
    };

    const rows = buildReportRows(input);
    expect(rows).toHaveLength(3);
    const table = renderTable(input);
    for (const col of TABLE_COLUMNS) expect(table).toContain(col);
    expect(table).toContain(EFFECTIVE_AFTER_RESTART);

    const snap = renderSnapshot(input);
    expect(snap[0]).toBe('[owflow] hooks: 2 loaded, 1 invalid');

    const json = JSON.parse(renderJson({ entries: [], bypassed: true }));
    expect(json.bypassed).toBe(true);
    expect(json.rows[0].status).toContain('OWFLOW_HOOKS_DISABLED=1');
  });

  test('buildStdinPayload strips class instance internals to identity keys and handles bigint', () => {
    class SecretModel {
      id = 'claude-4';
      providerID = 'anthropic';
      name = 'Claude';
      apiKey = 'sk-secret';
    }
    const raw = buildStdinPayload(
      HookEvent.ToolExecuteBefore,
      { tool: 'bash', count: 42n, model: new SecretModel() },
      { args: { command: 'ls' } },
      'ses_1',
    );
    expect(raw).not.toContain('sk-secret');
    expect(JSON.parse(raw)).toEqual({
      event: 'tool.execute.before',
      session: { sessionID: 'ses_1' },
      context: {
        tool: 'bash',
        count: '42',
        model: { id: 'claude-4', providerID: 'anthropic', name: 'Claude' },
        args: { command: 'ls' },
      },
    });
  });

  test('status and log readers handle missing, invalid, symlink, rotation, and latest filtering', async () => {
    const root = makeTempDir();
    expect(resolveHooksStatusFile(root)).toContain('owflow-hooks-');
    expect(resolveHooksLogFile(root)).toContain('owflow-hook-logs-');

    const prevStatus = process.env[STATUS_FILE_ENV];
    const prevLog = process.env[LOG_FILE_ENV];
    process.env[STATUS_FILE_ENV] = '/tmp/override-status.json';
    process.env[LOG_FILE_ENV] = '/tmp/override-log.jsonl';
    expect(resolveHooksStatusFile(root)).toBe('/tmp/override-status.json');
    expect(resolveHooksLogFile(root)).toBe('/tmp/override-log.jsonl');
    if (prevStatus === undefined) delete process.env[STATUS_FILE_ENV];
    else process.env[STATUS_FILE_ENV] = prevStatus;
    if (prevLog === undefined) delete process.env[LOG_FILE_ENV];
    else process.env[LOG_FILE_ENV] = prevLog;

    const statusFile = path.join(root, 'status.json');
    const logFile = path.join(root, 'logs.jsonl');
    expect(readHookStatusSnapshot(statusFile)).toEqual({ kind: 'missing' });
    expect(readHookLogRecords(logFile)).toEqual({ kind: 'missing' });

    fs.writeFileSync(statusFile, '{bad');
    fs.writeFileSync(logFile, '{bad\n');
    expect(readHookStatusSnapshot(statusFile)).toEqual({ kind: 'invalid' });
    expect(readHookLogRecords(logFile)).toEqual({ kind: 'ok', records: [], truncated: false });

    const symStatus = path.join(root, 'sym-status.json');
    fs.symlinkSync(statusFile, symStatus);
    expect(readHookStatusSnapshot(symStatus)).toEqual({ kind: 'invalid' });
    expect(readHookLogRecords(symStatus)).toEqual({ kind: 'invalid' });
  });

  test('re-exports wrapper API from hooks-wrapper.js', () => {
    expect(typeof initializeHooksWrapper).toBe('function');
    expect(typeof createDispatchHandlers).toBe('function');
    expect(typeof buildStdinPayload).toBe('function');
    expect(HOOK_TIMEOUT_ENV).toBe('OWFLOW_HOOK_TIMEOUT_MS');
    expect(MAX_CAPTURE_BYTES).toBe(16 * 1024);
    expect(MAX_LOG_FILE_BYTES).toBe(4 * 1024 * 1024);
  });

  test('readSessionLatestLogs and readLatestHookLog support session-specific log retrieval', async () => {
    const root = makeTempDir();
    const logFile = path.join(root, 'test-logs.jsonl');

    // Empty or missing file
    expect(readSessionLatestLogs(logFile, 'ses_1')).toEqual(new Map());
    expect(readSessionLatestLogs(logFile, '')).toEqual(new Map());

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

    fs.writeFileSync(logFile, [recordA1, recordA2, recordB1, recordOther].map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

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

    // readSessionHookLogs returns all records for that session event
    const ses1ToolLogs = readSessionHookLogs(logFile, HookEvent.ToolExecuteBefore, 0, 'ses_1');
    expect(ses1ToolLogs).toEqual([recordA1, recordA2] as HookRunLogRecord[]);
    const ses2ToolLogs = readSessionHookLogs(logFile, HookEvent.ToolExecuteBefore, 0, 'ses_2');
    expect(ses2ToolLogs).toEqual([recordOther] as HookRunLogRecord[]);
  });
});
