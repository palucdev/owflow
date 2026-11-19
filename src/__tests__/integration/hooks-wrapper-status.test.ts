import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import HooksWrapper from '../../hooks/hooks-wrapper.js';
import { DEFAULT_HOOK_TIMEOUT_MS } from '../../hooks/runtime/process-executor.js';
import { STATUS_DEBOUNCE_MS } from '../../hooks/runtime/status-recorder.js';
import { readHookStatusSnapshot } from '../../hooks/hooks-persistence.js';
import { HookEvent, HookRunState } from '../../types/hook-types.js';
import { DEFAULT_HOOK_CONTENT, EXECUTABLE_MODE } from '../fixtures/hooks/hooks-wrapper-fixtures.js';
import { removeScratchDirectory } from '../fixtures/hooks/scratch-cleanup.js';

const EXPECTED_DEFAULT_TIMEOUT_MS = 120_000;
const MOCK_PID = 12_345;
const SIGTERM_EXIT_CODE = 143;
const DEBOUNCE_EARLY_WAIT_MS = 15;
const DEBOUNCE_FLUSH_WAIT_MS = 65;
const EXPECTED_RENAME_COUNT_AFTER_RUN = 2;
const NULL_VALUE: null = JSON.parse('null');
const SCRATCH_ROOT = path.join(process.cwd(), '.test-scratch', 'hooks-wrapper-status');
const environment = Bun.env as Record<string, string | undefined>;

interface MockSetTimeoutOptions {
  onTimeout: (delayMs: number | undefined) => void;
  shouldInvoke?: boolean;
}

const mockSetTimeout = ({ onTimeout, shouldInvoke = true }: MockSetTimeoutOptions) => {
  const setTimeoutSpy = spyOn(globalThis, 'setTimeout');
  setTimeoutSpy.mockImplementation(((callback: () => void, delayMs?: number) => {
    if (delayMs !== STATUS_DEBOUNCE_MS) {
      onTimeout(delayMs);
      if (shouldInvoke) callback();
    }
    return 1 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout);
  return setTimeoutSpy;
};

const saveTimeoutEnvironment = (): string | undefined => {
  const previous = environment['OWFLOW_HOOK_TIMEOUT_MS'];
  delete environment['OWFLOW_HOOK_TIMEOUT_MS'];
  return previous;
};

const restoreTimeoutEnvironment = (previous: string | undefined): void => {
  if (previous === undefined) delete environment['OWFLOW_HOOK_TIMEOUT_MS'];
  else environment['OWFLOW_HOOK_TIMEOUT_MS'] = previous;
};

const makeKillingMockProcess = (): { mockProc: Record<string, unknown>; wasKilled: () => boolean } => {
  let isKilled = false;
  const { promise: exitPromise, resolve: exitResolver } = Promise.withResolvers<number>();
  const mockProc: Record<string, unknown> = {
    pid: MOCK_PID,
    kill: spyOn({ kill: () => {} }, 'kill').mockImplementation(() => {
      isKilled = true;
      exitResolver(SIGTERM_EXIT_CODE);
    }),
    exited: exitPromise,
    stdout: new Response('').body,
    stderr: new Response('').body,
    signalCode: NULL_VALUE as string | null,
  };
  return { mockProc, wasKilled: () => isKilled };
};

const makeResolvedMockProcess = (): Record<string, unknown> => ({
  pid: MOCK_PID,
  kill: () => {},
  exited: Promise.resolve(0),
  stdout: new Response('').body,
  stderr: new Response('').body,
  signalCode: NULL_VALUE as string | null,
});

const readHooksStatus = (file: string) => {
  const status = readHookStatusSnapshot(file);
  expect(status.kind).toBe('ok');
  if (status.kind !== 'ok') throw new Error('unreachable');
  return status.snapshot;
};

const spyOnStatusRenames = (): { renameSpy: ReturnType<typeof spyOn>; count: () => number } => {
  const renameSpy = spyOn(fs, 'renameSync');
  const count = () =>
    renameSpy.mock.calls.filter(([, newPath]) => typeof newPath === 'string' && newPath.includes('status.json')).length;
  return { renameSpy, count };
};

const createTimeoutHarness = () => {
  const { mockProc, wasKilled } = makeKillingMockProcess();
  const spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => mockProc as unknown as ReturnType<typeof Bun.spawn>);
  let recordedDelay: number | undefined;
  const setTimeoutSpy = mockSetTimeout({
    onTimeout: (delayMs) => {
      recordedDelay = delayMs;
    },
  });
  return { spawnSpy, setTimeoutSpy, wasKilled, recordedDelay: () => recordedDelay };
};

fs.rmSync(SCRATCH_ROOT, { recursive: true, force: true });
fs.mkdirSync(SCRATCH_ROOT, { recursive: true });

afterAll(() => {
  removeScratchDirectory(SCRATCH_ROOT);
});

describe('hooks-wrapper (hook timeout)', () => {
  test('default 2m timeout triggers when OWFLOW_HOOK_TIMEOUT_MS is unset', async () => {
    const root = path.join(SCRATCH_ROOT, 'timeout-default');
    fs.mkdirSync(path.join(root, '.owflow', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(root, '.owflow', 'hooks', 'config.sh'), DEFAULT_HOOK_CONTENT, { mode: EXECUTABLE_MODE });
    expect(DEFAULT_HOOK_TIMEOUT_MS).toBe(EXPECTED_DEFAULT_TIMEOUT_MS);

    const previousTimeout = saveTimeoutEnvironment();
    const harness = createTimeoutHarness();
    try {
      const wrapper = new HooksWrapper(root);
      await expect(wrapper.runHook({ event: HookEvent.Config, input: {} })).rejects.toThrow(/timed out after 120000ms/);
      expect(harness.recordedDelay()).toBe(EXPECTED_DEFAULT_TIMEOUT_MS);
      expect(harness.wasKilled()).toBe(true);
      wrapper.dispose();
    } finally {
      harness.setTimeoutSpy.mockRestore();
      harness.spawnSpy.mockRestore();
      restoreTimeoutEnvironment(previousTimeout);
    }
  });

  test('timeout is disabled when OWFLOW_HOOK_TIMEOUT_MS is set to 0', async () => {
    const root = path.join(SCRATCH_ROOT, 'timeout-disabled');
    fs.mkdirSync(path.join(root, '.owflow', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(root, '.owflow', 'hooks', 'config.sh'), DEFAULT_HOOK_CONTENT, { mode: EXECUTABLE_MODE });

    const previousTimeout = environment['OWFLOW_HOOK_TIMEOUT_MS'];
    environment['OWFLOW_HOOK_TIMEOUT_MS'] = '0';
    let isTimeoutScheduled = false;
    const setTimeoutSpy = mockSetTimeout({
      onTimeout: () => {
        isTimeoutScheduled = true;
      },
      shouldInvoke: false,
    });

    const mockProc = makeResolvedMockProcess();
    const spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => mockProc as unknown as ReturnType<typeof Bun.spawn>);
    try {
      const wrapper = new HooksWrapper(root);
      await wrapper.runHook({ event: HookEvent.Config, input: {} });
      expect(isTimeoutScheduled).toBe(false);
      wrapper.dispose();
    } finally {
      setTimeoutSpy.mockRestore();
      spawnSpy.mockRestore();
      if (previousTimeout === undefined) delete environment['OWFLOW_HOOK_TIMEOUT_MS'];
      else environment['OWFLOW_HOOK_TIMEOUT_MS'] = previousTimeout;
    }
  });
});

describe('hooks-wrapper (debug tracing)', () => {
  test('OWFLOW_DEBUG=1 logs real-time trace messages to console.error', async () => {
    const root = path.join(SCRATCH_ROOT, 'debug-trace');
    fs.mkdirSync(path.join(root, '.owflow', 'hooks'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.owflow', 'hooks', 'tool-execute-before.sh'),
      '#!/usr/bin/env bash\necho "debug-ok"\nexit 0\n',
      { mode: EXECUTABLE_MODE },
    );

    const errorLines: string[] = [];
    const errorSpy = spyOn(console, 'error').mockImplementation((message: string) => {
      errorLines.push(message);
    });

    const previousDebug = environment.OWFLOW_DEBUG;
    environment.OWFLOW_DEBUG = '1';

    try {
      const wrapper = new HooksWrapper(root);
      await wrapper.runHook({ event: HookEvent.ToolExecuteBefore, input: {}, output: {} });

      expect(errorLines.some((line) => line.includes('[owflow:debug] [tool.execute.before] Spawning'))).toBe(true);
      expect(
        errorLines.some(
          (line) => line.includes('[owflow:debug] [tool.execute.before] Finished') && line.includes('exitCode: 0'),
        ),
      ).toBe(true);
      wrapper.dispose();
    } finally {
      errorSpy.mockRestore();
      if (previousDebug === undefined) delete environment.OWFLOW_DEBUG;
      else environment.OWFLOW_DEBUG = previousDebug;
    }
  });
});

describe('hooks-wrapper (status debounce)', () => {
  // Flaky boi
  test('debounces transient PENDING status writes and atomically flushes terminal states', async () => {
    const root = path.join(SCRATCH_ROOT, 'debounce-flush');
    fs.mkdirSync(path.join(root, '.owflow', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(root, '.owflow', 'hooks', 'tool-execute-before.sh'), DEFAULT_HOOK_CONTENT, { mode: EXECUTABLE_MODE });
    const statusFile = path.join(root, 'status.json');
    const { renameSpy, count } = spyOnStatusRenames();

    try {
      const wrapper = new HooksWrapper(root, { statusFile });
      expect(count()).toBe(1);

      await wrapper.runHook({ event: HookEvent.ToolExecuteBefore, input: {}, output: {} });
      expect(count()).toBe(EXPECTED_RENAME_COUNT_AFTER_RUN);
      expect(readHooksStatus(statusFile).hooks[HookEvent.ToolExecuteBefore]?.status).toBe(HookRunState.SUCCESS);

      wrapper.dispose();
    } finally {
      renameSpy.mockRestore();
    }
  });

  test('flushes PENDING status after debounce delay for slow hooks and clears timer on dispose', async () => {
    const root = path.join(SCRATCH_ROOT, 'debounce-slow');
    fs.mkdirSync(path.join(root, '.owflow', 'hooks'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.owflow', 'hooks', 'tool-execute-before.sh'),
      '#!/usr/bin/env bash\nsleep 0.12\nexit 0\n',
      { mode: EXECUTABLE_MODE },
    );
    const statusFile = path.join(root, 'status-slow.json');

    const wrapper = new HooksWrapper(root, { statusFile });
    const runPromise = wrapper.runHook({ event: HookEvent.ToolExecuteBefore, input: {}, output: {} });

    await new Promise((resolve) => {
      setTimeout(resolve, DEBOUNCE_EARLY_WAIT_MS);
    });
    let status = readHooksStatus(statusFile);
    expect(status.hooks[HookEvent.ToolExecuteBefore]).toBeUndefined();

    await new Promise((resolve) => {
      setTimeout(resolve, DEBOUNCE_FLUSH_WAIT_MS);
    });
    status = readHooksStatus(statusFile);
    expect(status.hooks[HookEvent.ToolExecuteBefore]?.status).toBe(HookRunState.PENDING);

    await runPromise;
    status = readHooksStatus(statusFile);
    expect(status.hooks[HookEvent.ToolExecuteBefore]?.status).toBe(HookRunState.SUCCESS);

    wrapper.dispose();
  });
});
