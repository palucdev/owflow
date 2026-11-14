import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import HooksWrapper from '../../hooks/hooks-wrapper.js';
import { DEFAULT_HOOK_TIMEOUT_MS } from '../../hooks/runtime/process-executor.js';
import { STATUS_DEBOUNCE_MS } from '../../hooks/runtime/status-recorder.js';
import { HookEvent } from '../../types/hook-types.js';
import { cleanupWorkspaces, createWorkspace, writeHookScript } from './hooks-test-helpers.js';
import { createMockProcess, mockSpawn, mockSpawnResult, spyOnEnvironmentConfig } from './hooks-wrapper-test-helpers.js';

const TIMER_HANDLE = 1 as unknown as ReturnType<typeof setTimeout>;
const EXPECTED_DEFAULT_TIMEOUT_MS = 120_000;
const CONFIGURATION_SCRIPT_OUTPUT = '#!/usr/bin/env bash\necho "debug-ok"\nexit 0\n';
const DEBUG_SCRIPT_OUTPUT = '#!/usr/bin/env bash\necho "debug-ok"\nexit 0\n';
const DEFAULT_TIMEOUT_SCRIPT = '#!/usr/bin/env bash\nexit 0\n';

const mockTimeoutTimer = (onDelay: (delay: number | undefined) => void, shouldInvoke: boolean) =>
  spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void, delay?: number) => {
    if (delay !== STATUS_DEBOUNCE_MS) {
      onDelay(delay);
      if (shouldInvoke) callback();
    }
    return TIMER_HANDLE;
  }) as typeof setTimeout);

afterEach(cleanupWorkspaces);

describe('HooksWrapper timeout configuration', () => {
  test('defaults to a 2m timeout when configuration omits hookTimeoutMs', async () => {
    const workspace = createWorkspace('owflow-wrapper-unit-');
    writeHookScript({ workspace, fileName: 'config.sh', content: DEFAULT_TIMEOUT_SCRIPT });

    const mockProcess = createMockProcess();
    const spawnSpy = mockSpawn(mockProcess);
    const configSpy = spyOnEnvironmentConfig({ hookTimeoutMs: undefined });
    let recordedDelay: number | undefined;
    const setTimeoutSpy = mockTimeoutTimer((delay) => {
      recordedDelay = delay;
    }, true);

    try {
      const wrapper = new HooksWrapper(workspace);
      await expect(wrapper.dispatch(HookEvent.Config, {})).rejects.toThrow(/timed out after 120000ms/);
      expect(DEFAULT_HOOK_TIMEOUT_MS).toBe(EXPECTED_DEFAULT_TIMEOUT_MS);
      expect(recordedDelay).toBe(EXPECTED_DEFAULT_TIMEOUT_MS);
      expect(mockProcess.killCount()).toBe(1);
      wrapper.dispose();
    } finally {
      setTimeoutSpy.mockRestore();
      configSpy.mockRestore();
      spawnSpy.mockRestore();
    }
  });

  test('disables the timeout when hookTimeoutMs is configured to 0', async () => {
    const workspace = createWorkspace('owflow-wrapper-unit-');
    writeHookScript({ workspace, fileName: 'config.sh', content: CONFIGURATION_SCRIPT_OUTPUT });

    const spawnSpy = mockSpawnResult(0);
    const configSpy = spyOnEnvironmentConfig({ hookTimeoutMs: 0 });
    let isTimeoutScheduled = false;
    const setTimeoutSpy = mockTimeoutTimer(() => {
      isTimeoutScheduled = true;
    }, false);

    try {
      const wrapper = new HooksWrapper(workspace);
      await wrapper.dispatch(HookEvent.Config, {});
      expect(isTimeoutScheduled).toBe(false);
      wrapper.dispose();
    } finally {
      setTimeoutSpy.mockRestore();
      configSpy.mockRestore();
      spawnSpy.mockRestore();
    }
  });
});

describe('HooksWrapper debug tracing', () => {
  test('isDebugEnabled logs real-time trace messages to console.error', async () => {
    const workspace = createWorkspace('owflow-wrapper-unit-');
    writeHookScript({ workspace, fileName: 'tool-execute-before.sh', content: DEBUG_SCRIPT_OUTPUT });

    const errorLines: string[] = [];
    const errorSpy = spyOn(console, 'error').mockImplementation((message: string) => {
      errorLines.push(message);
    });
    const configSpy = spyOnEnvironmentConfig({ isDebugEnabled: true });

    try {
      const wrapper = new HooksWrapper(workspace);
      await wrapper.dispatch(HookEvent.ToolExecuteBefore, {}, {});

      expect(errorLines.some((line) => line.includes('[owflow:debug] [tool.execute.before] Spawning'))).toBe(true);
      expect(errorLines.some((line) => line.includes('[owflow:debug] [tool.execute.before] Finished') && line.includes('exitCode: 0'))).toBe(true);
      wrapper.dispose();
    } finally {
      errorSpy.mockRestore();
      configSpy.mockRestore();
    }
  });
});
