import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import HooksWrapper from '../../hooks/hooks-wrapper.js';
import { readHookLogRecords, readSessionHookLogs, resolveHooksLatestSymlink, resolveHooksLogFile } from '../../hooks/hooks-persistence.js';
import { buildExecutionArguments } from '../../hooks/runtime/process-executor.js';
import { HookEvent, HookRunState, type HookRegistryEntry } from '../../types/hook-types.js';
import { cleanupWorkspaces, createWorkspace, expectOkLogResult, writeHookScript } from './hooks-test-helpers.js';

const MAX_RUNS = 5;
const EXPECTED_REPEAT_RUNS = 3;
const FUTURE_TOLERANCE_MS = 10_000;
const TOOL_SCRIPT_OUTPUT = '#!/usr/bin/env bash\necho "out line"\necho "warn line" >&2\nexit 0\n';
const CHAT_SCRIPT_FAILURE = '#!/usr/bin/env bash\necho "policy violation" >&2\nexit 2\n';
const POWERSHELL_FLAGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File'];

interface EntryOptions {
  readonly path: string;
  readonly expected: string;
  readonly resolved: string;
}

const makeEntry = (options: EntryOptions): HookRegistryEntry => ({
  path: options.path,
  event: HookEvent.ToolExecuteBefore,
  interpreter: { resolved: options.resolved, expected: options.expected, available: true },
  status: 'registered',
});

const expectSuccessfulToolRun = (logFile: string): void => {
  const latestOk = readSessionHookLogs(logFile, HookEvent.ToolExecuteBefore, -Infinity, 'ses_ok').at(-1);
  expect(latestOk?.status).toBe(HookRunState.SUCCESS);
  expect(latestOk?.stdout).toBe('out line\n');
  expect(latestOk?.stderr).toBe('warn line\n');
  expect(readSessionHookLogs(logFile, HookEvent.ToolExecuteBefore, Date.now() + FUTURE_TOLERANCE_MS)).toEqual([]);
};

const expectSingleLogRecord = (logFile: string, expectedName: string): void => {
  const logs = expectOkLogResult(readHookLogRecords(logFile));
  expect(logs.records).toHaveLength(1);
  expect(logs.records[0]!.name).toBe(expectedName);
};

interface LogFileExpectation {
  readonly toolLogFile: string;
  readonly chatLogFile: string;
  readonly latestSymlink: string;
}

const expectRecordCount = (logFile: string, expectedCount: number): void => {
  expect(expectOkLogResult(readHookLogRecords(logFile)).records).toHaveLength(expectedCount);
};

const expectToolLogOnly = (expectation: LogFileExpectation): void => {
  const { toolLogFile, chatLogFile, latestSymlink } = expectation;
  expect(fs.existsSync(toolLogFile)).toBe(true);
  expect(fs.existsSync(chatLogFile)).toBe(false);
  expect(fs.readlinkSync(latestSymlink)).toBe(toolLogFile);
  expectSingleLogRecord(toolLogFile, 'tool-execute-before');
};

const expectChatLogActive = (expectation: LogFileExpectation): void => {
  const { toolLogFile, chatLogFile, latestSymlink } = expectation;
  expect(fs.existsSync(chatLogFile)).toBe(true);
  expect(fs.readlinkSync(latestSymlink)).toBe(chatLogFile);
  expectSingleLogRecord(chatLogFile, 'chat-message');
  expectSingleLogRecord(toolLogFile, 'tool-execute-before');
};

afterEach(cleanupWorkspaces);

describe('HooksWrapper gate execution', () => {
  test('git-hooks execution: exit 0 succeeds and non-zero fails closed with session abort', async () => {
    const workspace = createWorkspace('owflow-wrapper-unit-');
    const statusFile = path.join(workspace, 'status.json');
    const logFile = path.join(workspace, 'logs.jsonl');

    writeHookScript({ workspace, fileName: 'tool-execute-before.sh', content: TOOL_SCRIPT_OUTPUT });
    writeHookScript({ workspace, fileName: 'chat-message.sh', content: CHAT_SCRIPT_FAILURE });

    const endedSessions: string[] = [];
    const wrapper = new HooksWrapper(
      workspace,
      (sessionID) => {
        endedSessions.push(sessionID);
      },
      { statusFile, logFile },
    );

    try {
      await wrapper.dispatch(HookEvent.ToolExecuteBefore, { sessionID: 'ses_ok' }, {});
      expectSuccessfulToolRun(logFile);

      await wrapper.dispatch(HookEvent.ToolExecuteBefore, {}, {});
      const nonSession = readSessionHookLogs(logFile, HookEvent.ToolExecuteBefore).at(-1);
      expect(nonSession?.status).toBe(HookRunState.SUCCESS);
      expect(nonSession?.stdout).toBe('out line\n');
      expect(nonSession?.stderr).toBe('warn line\n');

      // Consecutive dispatches are each recorded with distinct runId in JSONL
      await wrapper.dispatch(HookEvent.ToolExecuteBefore, {}, {});
      expectRecordCount(logFile, EXPECTED_REPEAT_RUNS);

      await expect(wrapper.dispatch(HookEvent.ChatMessage, { sessionID: 'ses_fail' }, {})).rejects.toThrow(/Blocked: policy violation\./);
      expect(endedSessions).toEqual(['ses_fail']);
    } finally {
      wrapper.dispose();
    }
  });
});

describe('HooksWrapper run history', () => {
  test('preserves full run history across consecutive successful runs in the same session', async () => {
    const workspace = createWorkspace('owflow-wrapper-unit-');
    const statusFile = path.join(workspace, 'status-dedup.json');
    const logFile = path.join(workspace, 'logs-dedup.jsonl');
    writeHookScript({ workspace, fileName: 'tool-execute-before.sh' });

    const wrapper = new HooksWrapper(workspace, undefined, { statusFile, logFile });
    const sessionID = 'ses_multi_run';

    try {
      for (let index = 0; index < MAX_RUNS; index += 1) {
        await wrapper.dispatch(HookEvent.ToolExecuteBefore, { sessionID }, {});
      }

      const logs = readSessionHookLogs(logFile, HookEvent.ToolExecuteBefore, 0, sessionID);
      expect(logs).toHaveLength(MAX_RUNS);
      expect(logs.map((log) => log.runId)).toEqual([
        'tool.execute.before#1',
        'tool.execute.before#2',
        'tool.execute.before#3',
        'tool.execute.before#4',
        'tool.execute.before#5',
      ]);
    } finally {
      wrapper.dispose();
    }
  });
});

describe('HooksWrapper per-hook logs', () => {
  test('isolates runtime logs into per-hook files and updates latest symlink', async () => {
    const workspace = createWorkspace('owflow-wrapper-unit-');
    writeHookScript({ workspace, fileName: 'tool-execute-before.sh', content: TOOL_SCRIPT_OUTPUT });
    writeHookScript({ workspace, fileName: 'chat-message.sh', content: TOOL_SCRIPT_OUTPUT });

    const statusFile = path.join(workspace, 'status-isolated.json');
    const wrapper = new HooksWrapper(workspace, undefined, { statusFile });
    const sessionID = 'ses_per_hook';
    const latestSymlink = resolveHooksLatestSymlink(workspace);

    try {
      await wrapper.dispatch(HookEvent.ToolExecuteBefore, { sessionID }, {});

      const toolLogFile = resolveHooksLogFile(workspace, 'tool-execute-before');
      const chatLogFile = resolveHooksLogFile(workspace, 'chat-message');

      expectToolLogOnly({ toolLogFile, chatLogFile, latestSymlink });

      await wrapper.dispatch(HookEvent.ChatMessage, { sessionID }, {});

      expectChatLogActive({ toolLogFile, chatLogFile, latestSymlink });
    } finally {
      wrapper.dispose();
    }
  });
});

describe('HooksWrapper silent events', () => {
  test('silent successful event runs leave no status or log trace', async () => {
    const workspace = createWorkspace('owflow-wrapper-unit-');
    writeHookScript({ workspace, fileName: 'event.sh' });
    const logFile = path.join(workspace, 'logs.jsonl');

    const wrapper = new HooksWrapper(workspace, undefined, { logFile });
    try {
      await wrapper.dispatch(HookEvent.Event, {});
      expect(readHookLogRecords(logFile)).toEqual({ kind: 'missing' });
    } finally {
      wrapper.dispose();
    }
  });
});

describe('HooksWrapper spawn failures', () => {
  test('Bun.spawn throwing fails closed with clean Blocked error and records failure in logs', async () => {
    const workspace = createWorkspace('owflow-wrapper-unit-');
    writeHookScript({ workspace, fileName: 'tool-execute-before.sh' });
    const logFile = path.join(workspace, 'logs.jsonl');

    const spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    try {
      const wrapper = new HooksWrapper(workspace, undefined, { logFile });
      await expect(wrapper.dispatch(HookEvent.ToolExecuteBefore, {}, {})).rejects.toThrow(/Blocked: failed to spawn hook.*EACCES: permission denied/);

      const logs = expectOkLogResult(readHookLogRecords(logFile));
      expect(logs.records).toHaveLength(1);
      expect(logs.records[0]!.status).toBe(HookRunState.FAILURE);
      expect(logs.records[0]!.reason).toContain('EACCES: permission denied');
      wrapper.dispose();
    } finally {
      spawnSpy.mockRestore();
    }
  });
});

describe('buildExecutionArguments', () => {
  test('prepends PowerShell execution flags for .ps1 scripts', () => {
    const entry = makeEntry({
      path: '/workspace/.owflow/hooks/tool-execute-before.ps1',
      resolved: '/usr/bin/pwsh',
      expected: 'pwsh',
    });
    expect(buildExecutionArguments(entry)).toEqual(['/usr/bin/pwsh', ...POWERSHELL_FLAGS, entry.path]);
  });

  test('prepends PowerShell execution flags when interpreter is powershell.exe', () => {
    const entry = makeEntry({
      path: 'C:\\workspace\\.owflow\\hooks\\session-idle.ps1',
      resolved: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      expected: 'powershell.exe',
    });
    expect(buildExecutionArguments(entry)).toEqual([entry.interpreter.resolved, ...POWERSHELL_FLAGS, entry.path]);
  });

  test('prepends PowerShell execution flags when expected interpreter is pwsh even with non-standard path', () => {
    const entry = makeEntry({
      path: '/workspace/.owflow/hooks/custom-script',
      resolved: '/opt/microsoft/powershell/7/pwsh',
      expected: 'pwsh',
    });
    expect(buildExecutionArguments(entry)).toEqual(['/opt/microsoft/powershell/7/pwsh', ...POWERSHELL_FLAGS, entry.path]);
  });

  test('returns standard [resolved, path] arguments for non-PowerShell scripts', () => {
    const entry = makeEntry({
      path: '/workspace/.owflow/hooks/tool-execute-before.sh',
      resolved: '/bin/bash',
      expected: 'bash',
    });
    expect(buildExecutionArguments(entry)).toEqual(['/bin/bash', entry.path]);
  });
});
