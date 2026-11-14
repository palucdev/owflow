import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import path from 'node:path';
import HooksWrapper from '../../hooks/hooks-wrapper.js';
import { readHookStatusSnapshot, readSessionHookLogs } from '../../hooks/hooks-persistence.js';
import { canAbortSessionForEvent } from '../../hooks/runtime/failure-policy.js';
import { HookEvent, HookRunState } from '../../types/hook-types.js';
import { cleanupWorkspaces, createWorkspace, expectOkStatusResult, writeHookScript } from './hooks-test-helpers.js';
import { createMockProcess, mockSpawn } from './hooks-wrapper-test-helpers.js';

const NOOP = (): void => {};
const CIRCUIT_BREAKER_LIMIT = 4;
const SESSION_ABORT_COOLDOWN_TEST_SESSION = 'ses_dedup';

afterEach(cleanupWorkspaces);

describe('HooksWrapper snapshot initialization', () => {
  test('initializes snapshot of discovered hooks upon instantiation', () => {
    const workspace = createWorkspace('owflow-wrapper-unit-');
    writeHookScript({ workspace, fileName: 'tool-execute-before.sh' });

    const wrapper = new HooksWrapper(workspace);
    expect(wrapper.snapshot.entries).toHaveLength(1);
    expect(wrapper.snapshot.entries[0]!.event).toBe(HookEvent.ToolExecuteBefore);
    wrapper.dispose();
  });
});

describe('HooksWrapper missing interpreters', () => {
  test('missing interpreter fails closed and safely handles endSession callback errors', async () => {
    const workspace = createWorkspace('owflow-wrapper-unit-');
    writeHookScript({ workspace, fileName: 'config.sh' });

    const whichSpy = spyOn(Bun, 'which').mockReturnValue(undefined);
    const warnSpy = spyOn(console, 'warn').mockImplementation(NOOP);
    try {
      const wrapper = new HooksWrapper(workspace, () => {
        throw new Error('abort failed');
      });
      await expect(wrapper.dispatch(HookEvent.Config, { sessionID: 'ses_no_interp' })).rejects.toThrow(/bash interpreter is not available/);
      expect(warnSpy).toHaveBeenCalled();
      wrapper.dispose();
    } finally {
      whichSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});

describe('HooksWrapper disposal', () => {
  test('dispose kills active running processes', async () => {
    const workspace = createWorkspace('owflow-wrapper-unit-');
    writeHookScript({ workspace, fileName: 'config.sh' });

    const mockProcess = createMockProcess();
    const spawnSpy = mockSpawn(mockProcess);
    try {
      const wrapper = new HooksWrapper(workspace);
      const dispatchPromise = wrapper.dispatch(HookEvent.Config, {});
      expect(mockProcess.killCount()).toBe(0);

      wrapper.dispose();
      expect(mockProcess.killCount()).toBe(1);

      await expect(dispatchPromise).rejects.toThrow(/process terminated by signal SIGTERM/);

      wrapper.dispose();
      expect(mockProcess.killCount()).toBe(1);
    } finally {
      spawnSpy.mockRestore();
    }
  });
});

describe('session abort event policy', () => {
  test('should only allow session abort for active lifecycle gate events, not reactive host events or catch-all event', () => {
    expect(canAbortSessionForEvent(HookEvent.ToolExecuteBefore)).toBe(true);
    expect(canAbortSessionForEvent(HookEvent.ChatMessage)).toBe(true);
    expect(canAbortSessionForEvent(HookEvent.CommandExecuteBefore)).toBe(true);
    expect(canAbortSessionForEvent(HookEvent.Config)).toBe(true);

    expect(canAbortSessionForEvent('session.idle')).toBe(false);
    expect(canAbortSessionForEvent('session.status')).toBe(false);
    expect(canAbortSessionForEvent('session.error')).toBe(false);
    expect(canAbortSessionForEvent('file.edited')).toBe(false);
    expect(canAbortSessionForEvent(HookEvent.Event)).toBe(false);
  });
});

describe('session.idle failure handling', () => {
  test('should not call endSession when session.idle fails', async () => {
    const workspace = createWorkspace('owflow-wrapper-unit-');
    writeHookScript({ workspace, fileName: 'session-idle.sh', content: '#!/usr/bin/env bash\necho "test failed" >&2\nexit 1\n' });

    const statusFile = path.join(workspace, 'status.json');
    const logFile = path.join(workspace, 'logs.jsonl');
    const endedSessions: string[] = [];
    const wrapper = new HooksWrapper(
      workspace,
      (sessionID) => {
        endedSessions.push(sessionID);
      },
      { statusFile, logFile },
    );

    try {
      await expect(wrapper.dispatch('session.idle', { event: { type: 'session.idle', properties: { sessionID: 'ses_idle_1' } } })).rejects.toThrow(
        /Blocked: test failed\. Hint: fix the failing script .* \(failure recorded; fail closed\)/,
      );

      expect(endedSessions).toEqual([]);
      const snapshot = expectOkStatusResult(readHookStatusSnapshot(statusFile)).snapshot;
      expect(snapshot.hooks['session.idle']?.status).toBe(HookRunState.FAILURE);
      expect(snapshot.hooks['session.idle']?.reason).toBe('test failed');

      const latestIdleLog = readSessionHookLogs(logFile, 'session.idle', -Infinity, 'ses_idle_1').at(-1);
      expect(latestIdleLog?.status).toBe(HookRunState.FAILURE);
      expect(latestIdleLog?.reason).toBe('test failed');
    } finally {
      wrapper.dispose();
    }
  });
});

describe('idle interpreter availability', () => {
  test('should not abort an idle session without an interpreter while chat.message does', async () => {
    const workspace = createWorkspace('owflow-wrapper-unit-');
    writeHookScript({ workspace, fileName: 'session-idle.sh', content: '#!/usr/bin/env bash\nexit 0\n' });
    writeHookScript({ workspace, fileName: 'chat-message.sh', content: '#!/usr/bin/env bash\nexit 0\n' });

    const endedSessions: string[] = [];
    const whichSpy = spyOn(Bun, 'which').mockReturnValue(undefined);
    try {
      const wrapper = new HooksWrapper(workspace, (sessionID) => {
        endedSessions.push(sessionID);
      });
      await expect(
        wrapper.dispatch('session.idle', { event: { type: 'session.idle', properties: { sessionID: 'ses_idle_no_bash' } } }),
      ).rejects.toThrow(/bash interpreter is not available/);
      expect(endedSessions).toEqual([]);

      await expect(wrapper.dispatch(HookEvent.ChatMessage, { sessionID: 'ses_chat_no_bash' })).rejects.toThrow(/bash interpreter is not available/);
      expect(endedSessions).toEqual(['ses_chat_no_bash']);
      wrapper.dispose();
    } finally {
      whichSpy.mockRestore();
    }
  });
});

describe('session abort cooldown', () => {
  test('should deduplicate endSession calls per session within cooldown window and reset on chat.message', async () => {
    const workspace = createWorkspace('owflow-wrapper-unit-');
    writeHookScript({ workspace, fileName: 'tool-execute-before.sh', content: '#!/usr/bin/env bash\necho "tool gate failed" >&2\nexit 1\n' });
    writeHookScript({ workspace, fileName: 'command-execute-before.sh', content: '#!/usr/bin/env bash\necho "cmd gate failed" >&2\nexit 1\n' });

    const endedSessions: string[] = [];
    const wrapper = new HooksWrapper(workspace, (sessionID) => {
      endedSessions.push(sessionID);
    });

    try {
      await expect(wrapper.dispatch(HookEvent.ToolExecuteBefore, { sessionID: SESSION_ABORT_COOLDOWN_TEST_SESSION }, {})).rejects.toThrow(
        /tool gate failed/,
      );
      await expect(wrapper.dispatch(HookEvent.CommandExecuteBefore, { sessionID: SESSION_ABORT_COOLDOWN_TEST_SESSION }, {})).rejects.toThrow(
        /cmd gate failed/,
      );
      expect(endedSessions).toEqual([SESSION_ABORT_COOLDOWN_TEST_SESSION]);

      await wrapper.dispatch(HookEvent.ChatMessage, { sessionID: SESSION_ABORT_COOLDOWN_TEST_SESSION }, {});
      await expect(wrapper.dispatch(HookEvent.ToolExecuteBefore, { sessionID: SESSION_ABORT_COOLDOWN_TEST_SESSION }, {})).rejects.toThrow(
        /tool gate failed/,
      );
      expect(endedSessions).toEqual([SESSION_ABORT_COOLDOWN_TEST_SESSION, SESSION_ABORT_COOLDOWN_TEST_SESSION]);
    } finally {
      wrapper.dispose();
    }
  });
});

describe('circuit breaker integration', () => {
  test('should trip circuit breaker after 4 rapid consecutive failures and suppress spawns during cooldown', async () => {
    const workspace = createWorkspace('owflow-wrapper-unit-');
    writeHookScript({ workspace, fileName: 'session-idle.sh', content: '#!/usr/bin/env bash\necho "check failed" >&2\nexit 1\n' });

    const statusFile = path.join(workspace, 'status.json');
    const spawnSpy = spyOn(Bun, 'spawn');
    const warnSpy = spyOn(console, 'warn').mockImplementation(NOOP);

    try {
      const wrapper = new HooksWrapper(workspace, undefined, { statusFile });
      const payload = { event: { type: 'session.idle', properties: { sessionID: 'ses_cb' } } };

      for (let index = 0; index < CIRCUIT_BREAKER_LIMIT; index += 1) {
        await expect(wrapper.dispatch('session.idle', payload)).rejects.toThrow(/Blocked: check failed\./);
      }

      expect(spawnSpy).toHaveBeenCalledTimes(CIRCUIT_BREAKER_LIMIT);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('circuit breaker tripped'));

      await expect(wrapper.dispatch('session.idle', payload)).rejects.toThrow(/Blocked: Circuit breaker active for .*session-idle\.sh/);
      expect(spawnSpy).toHaveBeenCalledTimes(CIRCUIT_BREAKER_LIMIT);

      const snapshot = expectOkStatusResult(readHookStatusSnapshot(statusFile)).snapshot;
      expect(snapshot.hooks['session.idle']?.status).toBe(HookRunState.FAILURE);
      expect(snapshot.hooks['session.idle']?.reason).toContain('Circuit breaker active');

      wrapper.dispose();
    } finally {
      spawnSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
