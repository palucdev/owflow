import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import HooksWrapper, { NON_SESSION_STREAM_CAP_BYTES } from '../../hooks/hooks-wrapper.js';
import { readHookLogRecords } from '../../hooks/hooks-persistence.js';
import { HookEvent, HookRunState } from '../../types/hook-types.js';
import { DEFAULT_HOOK_CONTENT, EXECUTABLE_MODE } from '../fixtures/hooks/hooks-wrapper-fixtures.js';
import { removeScratchDirectory } from '../fixtures/hooks/scratch-cleanup.js';

const MOCK_PID = 12_345;
const SIGTERM_EXIT_CODE = 143;
const NULL_VALUE: null = JSON.parse('null');
const SCRATCH_ROOT = path.join(process.cwd(), '.test-scratch', 'hooks-wrapper-process');

const makeMockProcess = (): { mockProc: Record<string, unknown>; exitPromise: Promise<number> } => {
  const { promise: exitPromise, resolve: exitResolver } = Promise.withResolvers<number>();
  const mockProc: Record<string, unknown> = {
    pid: MOCK_PID,
    kill: spyOn({ kill: () => {} }, 'kill').mockImplementation(() => {
      mockProc.signalCode = 'SIGTERM';
      exitResolver(SIGTERM_EXIT_CODE);
    }),
    exited: exitPromise,
    stdout: new Response('').body,
    stderr: new Response('').body,
    signalCode: NULL_VALUE as string | null,
  };
  return { mockProc, exitPromise };
};

fs.rmSync(SCRATCH_ROOT, { recursive: true, force: true });
fs.mkdirSync(SCRATCH_ROOT, { recursive: true });

afterAll(() => {
  removeScratchDirectory(SCRATCH_ROOT);
});

describe('hooks-wrapper (interpreter failures and silent events)', () => {
  test('missing interpreter fails closed and safely handles endSession callback errors', async () => {
    const root = path.join(SCRATCH_ROOT, 'missing-interpreter');
    fs.mkdirSync(path.join(root, '.owflow', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(root, '.owflow', 'hooks', 'config.sh'), DEFAULT_HOOK_CONTENT, { mode: EXECUTABLE_MODE });

    const whichSpy = spyOn(Bun, 'which').mockReturnValue(NULL_VALUE);
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const wrapper = new HooksWrapper(root, {
        endSession: () => {
          throw new Error('abort failed');
        },
      });
      await expect(wrapper.runHook({ event: HookEvent.Config, input: { sessionID: 'ses_no_interp' } })).rejects.toThrow(
        /bash interpreter is not available/,
      );
      expect(warnSpy).toHaveBeenCalled();
      wrapper.dispose();
    } finally {
      whichSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  test('silent successful event runs leave no status or log trace', async () => {
    const root = path.join(SCRATCH_ROOT, 'silent-event');
    fs.mkdirSync(path.join(root, '.owflow', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(root, '.owflow', 'hooks', 'event.sh'), DEFAULT_HOOK_CONTENT, { mode: EXECUTABLE_MODE });
    const logFile = path.join(root, 'logs.jsonl');

    const wrapper = new HooksWrapper(root, { logFile });
    await wrapper.runHook({ event: HookEvent.Event, input: {} });

    expect(readHookLogRecords(logFile)).toEqual({ kind: 'missing' });
    wrapper.dispose();
  });
});

describe('hooks-wrapper (process lifecycle)', () => {
  test('dispose kills active running processes', async () => {
    const root = path.join(SCRATCH_ROOT, 'dispose-kills');
    fs.mkdirSync(path.join(root, '.owflow', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(root, '.owflow', 'hooks', 'config.sh'), DEFAULT_HOOK_CONTENT, { mode: EXECUTABLE_MODE });

    const { mockProc } = makeMockProcess();

    const spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => mockProc as unknown as ReturnType<typeof Bun.spawn>);
    try {
      const wrapper = new HooksWrapper(root);
      const runPromise = wrapper.runHook({ event: HookEvent.Config, input: {} });
      expect(mockProc.kill).not.toHaveBeenCalled();

      wrapper.dispose();
      expect(mockProc.kill).toHaveBeenCalledTimes(1);

      await expect(runPromise).rejects.toThrow(/process terminated by signal SIGTERM/);

      // Subsequent dispose calls are safe and do not re-kill
      wrapper.dispose();
      expect(mockProc.kill).toHaveBeenCalledTimes(1);
    } finally {
      spawnSpy.mockRestore();
    }
  });

  test('Bun.spawn throwing fails closed with clean Blocked error and records failure in logs', async () => {
    const root = path.join(SCRATCH_ROOT, 'spawn-throwing');
    fs.mkdirSync(path.join(root, '.owflow', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(root, '.owflow', 'hooks', 'tool-execute-before.sh'), DEFAULT_HOOK_CONTENT, { mode: EXECUTABLE_MODE });

    const spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });
    const logFile = path.join(root, 'logs.jsonl');

    try {
      const wrapper = new HooksWrapper(root, { logFile });
      await expect(wrapper.runHook({ event: HookEvent.ToolExecuteBefore, input: {}, output: {} })).rejects.toThrow(
        /Blocked: failed to spawn hook.*EACCES: permission denied/,
      );

      const logs = readHookLogRecords(logFile);
      expect(logs.kind).toBe('ok');
      if (logs.kind !== 'ok') throw new Error('unreachable');
      expect(logs.records).toHaveLength(1);
      expect(logs.records[0]!.status).toBe(HookRunState.FAILURE);
      expect(logs.records[0]!.reason).toContain('EACCES: permission denied');
      wrapper.dispose();
    } finally {
      spawnSpy.mockRestore();
    }
  });
});

describe('hooks-wrapper (stream capping)', () => {
  test('non-session hook run caps logged stdout to NON_SESSION_STREAM_CAP_BYTES in jsonl logs', async () => {
    const root = path.join(SCRATCH_ROOT, 'stream-capping');
    fs.mkdirSync(path.join(root, '.owflow', 'hooks'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.owflow', 'hooks', 'tool-execute-before.sh'),
      "#!/usr/bin/env bash\nhead -c 32768 < /dev/zero | tr '\\0' 'A'\nexit 0\n",
      { mode: EXECUTABLE_MODE },
    );
    const logFile = path.join(root, 'logs.jsonl');

    const wrapper = new HooksWrapper(root, { logFile });
    await wrapper.runHook({
      event: HookEvent.ToolExecuteBefore,
      input: {
        tool: 'bash',
        args: { command: 'test' },
      },
    });

    const logResult = readHookLogRecords(logFile);
    expect(logResult.kind).toBe('ok');
    if (logResult.kind !== 'ok') throw new Error('unreachable');
    expect(logResult.records).toHaveLength(1);
    expect(logResult.records[0]!.stdout?.length).toBe(NON_SESSION_STREAM_CAP_BYTES);

    wrapper.dispose();
  });
});
