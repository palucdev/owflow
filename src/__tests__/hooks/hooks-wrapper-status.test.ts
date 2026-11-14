import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import HooksWrapper, { StatusRecorder } from '../../hooks/hooks-wrapper.js';
import { readHookStatusSnapshot } from '../../hooks/hooks-persistence.js';
import { HookEvent, HookRunState } from '../../types/hook-types.js';
import { cleanupWorkspaces, createWorkspace, expectOkStatusResult, writeHookScript } from './hooks-test-helpers.js';

const PENDING_CHECK_DELAY_MS = 15;
const DEBOUNCE_WAIT_MS = 65;
const STATUS_WRITE_COUNTS = { initial: 1, terminal: 2 };

afterEach(cleanupWorkspaces);

describe('status persistence timing', () => {
  test('debounces transient PENDING status writes and atomically flushes terminal states', async () => {
    const workspace = createWorkspace('owflow-wrapper-unit-');
    writeHookScript({ workspace, fileName: 'tool-execute-before.sh' });
    const statusFile = path.join(workspace, 'status.json');

    let renameCount = 0;
    const originalRenameSync = fs.renameSync;
    const renameSpy = spyOn(fs, 'renameSync').mockImplementation((oldPath, newPath) => {
      if (typeof newPath === 'string' && newPath.includes('status.json')) {
        renameCount += 1;
      }
      return originalRenameSync(oldPath, newPath);
    });

    try {
      const wrapper = new HooksWrapper(workspace, undefined, { statusFile });
      expect(renameCount).toBe(STATUS_WRITE_COUNTS.initial);

      await wrapper.dispatch(HookEvent.ToolExecuteBefore, {}, {});
      expect(renameCount).toBe(STATUS_WRITE_COUNTS.terminal);

      const status = expectOkStatusResult(readHookStatusSnapshot(statusFile));
      expect(status.snapshot.hooks[HookEvent.ToolExecuteBefore]?.status).toBe(HookRunState.SUCCESS);

      wrapper.dispose();
    } finally {
      renameSpy.mockRestore();
    }
  });

  test('flushes PENDING status after debounce delay for slow hooks and clears timer on dispose', async () => {
    const workspace = createWorkspace('owflow-wrapper-unit-');
    writeHookScript({ workspace, fileName: 'tool-execute-before.sh', content: '#!/usr/bin/env bash\nsleep 0.12\nexit 0\n' });
    const statusFile = path.join(workspace, 'status-slow.json');

    const wrapper = new HooksWrapper(workspace, undefined, { statusFile });
    const dispatchPromise = wrapper.dispatch(HookEvent.ToolExecuteBefore, {}, {});

    await new Promise((resolve) => setTimeout(resolve, PENDING_CHECK_DELAY_MS));
    let status = expectOkStatusResult(readHookStatusSnapshot(statusFile));
    expect(status.snapshot.hooks[HookEvent.ToolExecuteBefore]).toBeUndefined();

    await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_WAIT_MS));
    status = expectOkStatusResult(readHookStatusSnapshot(statusFile));
    expect(status.snapshot.hooks[HookEvent.ToolExecuteBefore]?.status).toBe(HookRunState.PENDING);

    await dispatchPromise;
    status = expectOkStatusResult(readHookStatusSnapshot(statusFile));
    expect(status.snapshot.hooks[HookEvent.ToolExecuteBefore]?.status).toBe(HookRunState.SUCCESS);

    wrapper.dispose();
  });
});

describe('atomic status flush cleanup', () => {
  test('flushStatusFileAtomic cleans up .tmp file when write or rename throws', () => {
    const workspace = createWorkspace('owflow-wrapper-unit-');
    const statusFile = path.join(workspace, 'atomic-status.json');
    const recorder = new StatusRecorder({ directory: workspace, statusFile });

    const renameSpy = spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('EACCES: mock rename failure');
    });

    try {
      recorder.flushStatusFileAtomic(statusFile, workspace, new Map());
      const temporaryFiles = fs.readdirSync(workspace).filter((fileName) => fileName.endsWith('.tmp'));
      expect(temporaryFiles).toHaveLength(0);
    } finally {
      renameSpy.mockRestore();
      recorder.dispose();
    }
  });
});
