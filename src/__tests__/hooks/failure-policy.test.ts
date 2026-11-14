import { describe, expect, it } from 'bun:test';
import { HookEvent } from '../../types/hook-types.js';
import { HookFailureTracker, MAX_HOOK_FAILURES, buildProcessFailureError } from '../../hooks/runtime/failure-policy.js';

describe('HookFailureTracker', () => {
  it('should track failures per event, checkKey, and session', () => {
    const tracker = new HookFailureTracker();

    expect(tracker.getCount('tool.execute.before', 'script1', 'sess-1')).toBe(0);
    expect(tracker.recordFailure('tool.execute.before', 'script1', 'sess-1')).toBe(1);
    expect(tracker.getCount('tool.execute.before', 'script1', 'sess-1')).toBe(1);

    expect(tracker.recordFailure('tool.execute.before', 'script1', 'sess-1')).toBe(2);
    expect(tracker.getCount('tool.execute.before', 'script1', 'sess-1')).toBe(2);

    // Isolated per checkKey
    expect(tracker.getCount('tool.execute.before', 'script2', 'sess-1')).toBe(0);
    // Isolated per session
    expect(tracker.getCount('tool.execute.before', 'script1', 'sess-2')).toBe(0);
  });

  it('should reset count on recordSuccess', () => {
    const tracker = new HookFailureTracker();

    tracker.recordFailure('tool.execute.before', 'script1', 'sess-1');
    tracker.recordFailure('tool.execute.before', 'script1', 'sess-1');
    expect(tracker.getCount('tool.execute.before', 'script1', 'sess-1')).toBe(2);

    tracker.recordSuccess('tool.execute.before', 'script1', 'sess-1');
    expect(tracker.getCount('tool.execute.before', 'script1', 'sess-1')).toBe(0);
  });

  it('should clear all tracked failures on clear()', () => {
    const tracker = new HookFailureTracker();

    tracker.recordFailure('tool.execute.before', 'script1', 'sess-1');
    tracker.recordFailure('tool.execute.after', 'script2', 'sess-2');
    expect(tracker.getCount('tool.execute.before', 'script1', 'sess-1')).toBe(1);
    expect(tracker.getCount('tool.execute.after', 'script2', 'sess-2')).toBe(1);

    tracker.clear();
    expect(tracker.getCount('tool.execute.before', 'script1', 'sess-1')).toBe(0);
    expect(tracker.getCount('tool.execute.after', 'script2', 'sess-2')).toBe(0);
  });
});

describe('buildProcessFailureError', () => {
  it('should format message with attempt and hint when attempt < maxAttempts', () => {
    const error = buildProcessFailureError(
      '/path/hook.sh',
      'Lint failed. Hint: Fix syntax errors',
      HookEvent.ToolExecuteBefore,
      1,
      MAX_HOOK_FAILURES,
    );

    expect(error.message).toBe('Blocked: Lint failed (attempt 1/3). Hint: Fix syntax errors');
  });

  it('should format critical halting message when attempt >= maxAttempts', () => {
    const error = buildProcessFailureError(
      '/path/hook.sh',
      'Lint failed. Hint: Fix syntax errors',
      HookEvent.ToolExecuteBefore,
      3,
      MAX_HOOK_FAILURES,
    );

    expect(error.message).toBe('Blocked: CRITICAL: Lint failed 3 times. Halting conversation. Hint: Fix syntax errors');
  });

  it('should preserve existing CRITICAL reason when attempt >= maxAttempts', () => {
    const error = buildProcessFailureError(
      '/path/hook.sh',
      'CRITICAL: Attempted to modify eslint.config.mjs 3 times. Stopping conversation. Hint: Ask the user.',
      HookEvent.ToolExecuteBefore,
      3,
      MAX_HOOK_FAILURES,
    );

    expect(error.message).toBe('Blocked: CRITICAL: Attempted to modify eslint.config.mjs 3 times. Stopping conversation. Hint: Ask the user.');
  });

  it('should parse json error payload if present', () => {
    const jsonPayload = JSON.stringify({
      decision: 'block',
      reason: 'Modifying config is forbidden. Hint: Contact admin',
    });
    const error = buildProcessFailureError('/path/hook.sh', jsonPayload, HookEvent.ToolExecuteBefore, 2, MAX_HOOK_FAILURES);

    expect(error.message).toBe('Blocked: Modifying config is forbidden (attempt 2/3). Hint: Contact admin');
  });

  it('should format default message when attempt is undefined', () => {
    const error = buildProcessFailureError('/path/hook.sh', 'exit 1', HookEvent.ToolExecuteBefore);

    expect(error.message).toContain('Blocked: exit 1.');
    expect(error.message).toContain('Hint: fix the failing script /path/hook.sh');
  });
});
