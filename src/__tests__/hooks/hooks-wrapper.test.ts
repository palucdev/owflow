import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import HooksWrapper from '../../hooks/hooks-wrapper.js';
import { readHookLogRecords, readSessionHookLogs, resolveHooksLatestSymlink, resolveHooksLogFile } from '../../hooks/hooks-persistence.js';
import { HookEventName, HookRunState, type HookRunLogRecord } from '../../types/hook-types.js';
import { DEFAULT_HOOK_CONTENT, EXECUTABLE_MODE } from '../fixtures/hooks/hooks-wrapper-fixtures.js';
import { removeScratchDirectory } from '../fixtures/hooks/scratch-cleanup.js';
import { isSymlinkCreationSupported } from '../fixtures/hooks/platform-support.js';

const EXPECTED_NON_SESSION_LOG_COUNT = 2;
const HISTORY_RUN_COUNT = 5;
const FUTURE_OFFSET_MS = 10_000;
const SCRATCH_ROOT = path.join(process.cwd(), '.test-scratch', 'hooks-wrapper');
const ECHO_LINES_HOOK = '#!/usr/bin/env bash\necho "out line"\necho "warn line" >&2\nexit 0\n';
const POLICY_VIOLATION_HOOK = '#!/usr/bin/env bash\necho "policy violation" >&2\nexit 2\n';
const TOOL_OUT_HOOK = '#!/usr/bin/env bash\necho "tool out"\nexit 0\n';
const CHAT_OUT_HOOK = '#!/usr/bin/env bash\necho "chat out"\nexit 0\n';

const readLatestLogRecord = (file: string): HookRunLogRecord => {
  const result = readHookLogRecords(file);
  expect(result.kind).toBe('ok');
  if (result.kind !== 'ok') throw new Error('unreachable');
  expect(result.records.length).toBeGreaterThan(0);
  return result.records.at(-1)!;
};

const countLogRecords = (file: string): number => {
  const result = readHookLogRecords(file);
  expect(result.kind).toBe('ok');
  if (result.kind !== 'ok') throw new Error('unreachable');
  return result.records.length;
};

fs.rmSync(SCRATCH_ROOT, { recursive: true, force: true });
fs.mkdirSync(SCRATCH_ROOT, { recursive: true });

afterAll(() => {
  removeScratchDirectory(SCRATCH_ROOT);
});

describe('hooks-wrapper (initialization and persistence safety)', () => {
  test('initializes snapshot of discovered hooks upon instantiation', () => {
    const root = path.join(SCRATCH_ROOT, 'init-snapshot');
    fs.mkdirSync(path.join(root, '.owflow', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(root, '.owflow', 'hooks', 'tool-execute-before.sh'), DEFAULT_HOOK_CONTENT, { mode: EXECUTABLE_MODE });

    const wrapper = new HooksWrapper(root);
    expect(wrapper.snapshot.entries).toHaveLength(1);
    expect(wrapper.snapshot.entries[0]!.event).toBe(HookEventName.ToolExecuteBefore);
    wrapper.dispose();
  });

  test.skipIf(!isSymlinkCreationSupported)(
    'runtime status and log persistence safely ignore dangling symlinks and clean up symlink rotation targets',
    async () => {
      const root = path.join(SCRATCH_ROOT, 'dangling-symlinks');
      fs.mkdirSync(path.join(root, '.owflow', 'hooks'), { recursive: true });
      fs.writeFileSync(path.join(root, '.owflow', 'hooks', 'tool-execute-before.sh'), DEFAULT_HOOK_CONTENT, { mode: EXECUTABLE_MODE });

      const targetFile = path.join(root, 'target-status.txt');
      const danglingStatus = path.join(root, 'dangling-status.json');
      fs.symlinkSync(targetFile, danglingStatus);

      const targetLog = path.join(root, 'target-log.txt');
      const danglingLog = path.join(root, 'dangling-log.jsonl');
      fs.symlinkSync(targetLog, danglingLog);

      const wrapper = new HooksWrapper(root, {
        statusFile: danglingStatus,
        logFile: danglingLog,
      });
      await wrapper.runHook({ event: HookEventName.ToolExecuteBefore, input: { sessionID: 'ses_sym' }, output: {} });
      wrapper.dispose();

      // Neither target file should have been created or written to
      expect(fs.existsSync(targetFile)).toBe(false);
      expect(fs.existsSync(targetLog)).toBe(false);
    },
  );
});

describe('hooks-wrapper (git-hooks execution)', () => {
  test('exit 0 succeeds and records session stdout and stderr', async () => {
    const root = path.join(SCRATCH_ROOT, 'git-hooks-success');
    const statusFile = path.join(root, 'status.json');
    const logFile = path.join(root, 'logs.jsonl');
    fs.mkdirSync(path.join(root, '.owflow', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(root, '.owflow', 'hooks', 'tool-execute-before.sh'), ECHO_LINES_HOOK, { mode: EXECUTABLE_MODE });

    const wrapper = new HooksWrapper(root, { statusFile, logFile });

    // Session hook run writes stdout and stderr directly to JSONL records
    await wrapper.runHook({ event: HookEventName.ToolExecuteBefore, input: { sessionID: 'ses_ok' }, output: {} });
    const latestOk = readSessionHookLogs({ file: logFile, event: HookEventName.ToolExecuteBefore, since: -Infinity, sessionID: 'ses_ok' }).at(-1);
    expect(latestOk?.status).toBe(HookRunState.SUCCESS);
    expect(latestOk?.stdout).toBe('out line\n');
    expect(latestOk?.stderr).toBe('warn line\n');
    expect(readSessionHookLogs({ file: logFile, event: HookEventName.ToolExecuteBefore, since: Date.now() + FUTURE_OFFSET_MS })).toEqual([]);

    wrapper.dispose();
  });

  test('non-session hook runs are each recorded with a distinct runId', async () => {
    const root = path.join(SCRATCH_ROOT, 'distinct-runids');
    const logFile = path.join(root, 'logs.jsonl');
    fs.mkdirSync(path.join(root, '.owflow', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(root, '.owflow', 'hooks', 'tool-execute-before.sh'), ECHO_LINES_HOOK, { mode: EXECUTABLE_MODE });

    const wrapper = new HooksWrapper(root, { logFile });

    await wrapper.runHook({ event: HookEventName.ToolExecuteBefore, input: {}, output: {} });
    const nonSession = readSessionHookLogs({ file: logFile, event: HookEventName.ToolExecuteBefore }).at(-1);
    expect(nonSession?.status).toBe(HookRunState.SUCCESS);
    expect(nonSession?.stdout).toBe('out line\n');
    expect(nonSession?.stderr).toBe('warn line\n');

    // Consecutive runs are each recorded with distinct runId in JSONL
    await wrapper.runHook({ event: HookEventName.ToolExecuteBefore, input: {}, output: {} });
    const logsAfterRepeat = readHookLogRecords(logFile);
    expect(logsAfterRepeat.kind).toBe('ok');
    if (logsAfterRepeat.kind !== 'ok') throw new Error('unreachable');
    expect(logsAfterRepeat.records).toHaveLength(EXPECTED_NON_SESSION_LOG_COUNT);

    wrapper.dispose();
  });

  test('non-zero exit fails closed and ends the session', async () => {
    const root = path.join(SCRATCH_ROOT, 'fail-closed');
    const logFile = path.join(root, 'logs.jsonl');
    fs.mkdirSync(path.join(root, '.owflow', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(root, '.owflow', 'hooks', 'chat-message.sh'), POLICY_VIOLATION_HOOK, { mode: EXECUTABLE_MODE });

    const ended: string[] = [];
    const wrapper = new HooksWrapper(root, {
      endSession: (sessionID) => {
        ended.push(sessionID);
      },
      logFile,
    });

    await expect(wrapper.runHook({ event: HookEventName.ChatMessage, input: { sessionID: 'ses_fail' }, output: {} })).rejects.toThrow(
      /Blocked: policy violation\./,
    );
    expect(ended).toEqual(['ses_fail']);

    wrapper.dispose();
  });
});

describe('hooks-wrapper (run history)', () => {
  test('preserves full run history across consecutive successful runs in the same session', async () => {
    const root = path.join(SCRATCH_ROOT, 'run-history');
    const statusFile = path.join(root, 'status-dedup.json');
    const logFile = path.join(root, 'logs-dedup.jsonl');
    fs.mkdirSync(path.join(root, '.owflow', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(root, '.owflow', 'hooks', 'tool-execute-before.sh'), DEFAULT_HOOK_CONTENT, { mode: EXECUTABLE_MODE });

    const wrapper = new HooksWrapper(root, { statusFile, logFile });
    const sessionID = 'ses_multi_run';

    for (let index = 0; index < HISTORY_RUN_COUNT; index += 1) {
      await wrapper.runHook({ event: HookEventName.ToolExecuteBefore, input: { sessionID }, output: {} });
    }

    const logs = readSessionHookLogs({ file: logFile, event: HookEventName.ToolExecuteBefore, since: 0, sessionID: sessionID });
    expect(logs).toHaveLength(HISTORY_RUN_COUNT);
    expect(logs.map((logRecord) => logRecord.runId)).toEqual([
      'tool.execute.before#1',
      'tool.execute.before#2',
      'tool.execute.before#3',
      'tool.execute.before#4',
      'tool.execute.before#5',
    ]);

    wrapper.dispose();
  });
});

describe('hooks-wrapper (per-hook log isolation)', () => {
  test('isolates tool logs into a per-hook file and updates the latest symlink', async () => {
    const root = path.join(SCRATCH_ROOT, 'per-hook-isolated');
    fs.mkdirSync(path.join(root, '.owflow', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(root, '.owflow', 'hooks', 'tool-execute-before.sh'), TOOL_OUT_HOOK, { mode: EXECUTABLE_MODE });

    const statusFile = path.join(root, 'status-isolated.json');
    const wrapper = new HooksWrapper(root, { statusFile });
    const sessionID = 'ses_per_hook';
    const latestSymlink = resolveHooksLatestSymlink(root);

    // Run tool.execute.before
    await wrapper.runHook({ event: HookEventName.ToolExecuteBefore, input: { sessionID }, output: {} });

    const logFileTool = resolveHooksLogFile(root, 'tool-execute-before');
    const logFileChat = resolveHooksLogFile(root, 'chat-message');

    expect(await Bun.file(logFileTool).exists()).toBe(true);
    expect(await Bun.file(logFileChat).exists()).toBe(false);
    if (isSymlinkCreationSupported) {
      expect(fs.readlinkSync(latestSymlink)).toBe(logFileTool);
    }

    const toolLogs = readLatestLogRecord(logFileTool);
    expect(toolLogs.name).toBe('tool-execute-before');

    wrapper.dispose();
  });

  test('keeps per-hook files isolated when another hook runs', async () => {
    const root = path.join(SCRATCH_ROOT, 'per-hook-cross');
    const hooksDirectory = path.join(root, '.owflow', 'hooks');
    fs.mkdirSync(hooksDirectory, { recursive: true });
    fs.writeFileSync(path.join(hooksDirectory, 'tool-execute-before.sh'), TOOL_OUT_HOOK, { mode: EXECUTABLE_MODE });
    fs.writeFileSync(path.join(hooksDirectory, 'chat-message.sh'), CHAT_OUT_HOOK, { mode: EXECUTABLE_MODE });

    const wrapper = new HooksWrapper(root, { statusFile: path.join(root, 'status-isolated.json') });
    const sessionID = 'ses_per_hook';
    const latestSymlink = resolveHooksLatestSymlink(root);
    await wrapper.runHook({ event: HookEventName.ToolExecuteBefore, input: { sessionID }, output: {} });

    const logFileTool = resolveHooksLogFile(root, 'tool-execute-before');
    const logFileChat = resolveHooksLogFile(root, 'chat-message');
    const toolCountBefore = countLogRecords(logFileTool);

    // Run chat.message
    await wrapper.runHook({ event: HookEventName.ChatMessage, input: { sessionID }, output: {} });

    expect(await Bun.file(logFileChat).exists()).toBe(true);
    if (isSymlinkCreationSupported) {
      expect(fs.readlinkSync(latestSymlink)).toBe(logFileChat);
    }

    expect(readLatestLogRecord(logFileChat).name).toBe('chat-message');

    // Verify the chat run added no tool log record (isolated!)
    expect(countLogRecords(logFileTool)).toBe(toolCountBefore);

    wrapper.dispose();
  });
});
