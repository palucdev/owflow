import { describe, expect, test } from 'bun:test';
import {
  SessionAbortController,
  buildCircuitBreakerError,
  buildInterpreterUnavailableError,
  buildProcessFailureError,
  buildSpawnError,
  canAbortSessionForEvent,
} from '../../../hooks/runtime/failure-policy.js';
import { HookEvent } from '../../../types/hook-types.js';

const LONG_LINE_LENGTH = 300;
const TRUNCATED_PREFIX_LENGTH = 197;

describe('failure-policy (session abort gating)', () => {
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

describe('failure-policy (session abort controller)', () => {
  test('SessionAbortController manages cooldown, session clearing, and disposal', async () => {
    const aborted: string[] = [];
    const controller = new SessionAbortController((sessionID) => {
      aborted.push(sessionID);
    });

    await controller.abortSession(HookEvent.ToolExecuteBefore, 'ses_abc', '/path/to/script.sh');
    expect(aborted).toEqual(['ses_abc']);

    // Within cooldown, second abort is suppressed
    await controller.abortSession(HookEvent.ToolExecuteBefore, 'ses_abc', '/path/to/script.sh');
    expect(aborted).toEqual(['ses_abc']);

    // Clearing session cooldown allows another abort
    controller.clearSession('ses_abc');
    await controller.abortSession(HookEvent.ToolExecuteBefore, 'ses_abc', '/path/to/script.sh');
    expect(aborted).toEqual(['ses_abc', 'ses_abc']);

    controller.dispose();
  });

  test('SessionAbortController skips abort without sessionID, endSession, or for non-abortable events', async () => {
    const aborted: string[] = [];
    const controller = new SessionAbortController((sessionID) => {
      aborted.push(sessionID);
    });

    // No sessionID
    await controller.abortSession({ event: HookEvent.ToolExecuteBefore, scriptPath: '/a.sh' });
    // Non-abortable reactive event
    await controller.abortSession({ event: 'session.idle', sessionID: 'ses_x', scriptPath: '/a.sh' });
    expect(aborted).toEqual([]);

    // endSession throwing is swallowed with a warning
    const failing = new SessionAbortController(() => {
      throw new Error('abort exploded');
    });
    const warnSpy = console.warn;
    console.warn = () => {};
    try {
      await failing.abortSession({ event: HookEvent.ChatMessage, sessionID: 'ses_y', scriptPath: '/a.sh' });
    } finally {
      console.warn = warnSpy;
    }

    controller.dispose();
  });
});

describe('failure-policy (Blocked error builders)', () => {
  test('error builders generate expected Blocked error messages and hints', () => {
    const callbackError = buildCircuitBreakerError('/path/hook.sh', 'too many failures');
    expect(callbackError.message).toBe('Blocked: too many failures. Hint: fix /path/hook.sh or wait for cooldown.');

    const interpError = buildInterpreterUnavailableError('/path/hook.sh', 'pwsh');
    expect(interpError.message).toContain('the pwsh interpreter is not available');

    const spawnError = buildSpawnError('/path/hook.sh', 'permission denied', HookEvent.ToolExecuteBefore);
    expect(spawnError.message).toContain('failed to spawn hook /path/hook.sh: permission denied');
    expect(spawnError.message).toContain('failure ends the current session; fail closed');

    const procError = buildProcessFailureError('/path/hook.sh', 'exit 1', HookEvent.ToolExecuteBefore);
    expect(procError.message).toContain('Blocked: exit 1. Hint: fix the failing script');

    const nonAbortProcError = buildProcessFailureError('/path/hook.sh', 'exit 1', 'session.idle');
    expect(nonAbortProcError.message).toContain('failure recorded; fail closed');
  });

  test('buildProcessFailureError summarizes multiline reasons and truncates long first lines', () => {
    const multiline = buildProcessFailureError('/a.sh', '\n\n  first line matters\nsecond line', HookEvent.ChatMessage);
    expect(multiline.message).toContain('Blocked: first line matters');

    const longLine = 'x'.repeat(LONG_LINE_LENGTH);
    const truncated = buildProcessFailureError('/a.sh', longLine, HookEvent.ChatMessage);
    expect(truncated.message).toContain('x'.repeat(TRUNCATED_PREFIX_LENGTH) + '...');

    const missingReason = buildProcessFailureError('/a.sh', undefined, HookEvent.ChatMessage);
    expect(missingReason.message).toContain('hook /a.sh failed');
  });
});
