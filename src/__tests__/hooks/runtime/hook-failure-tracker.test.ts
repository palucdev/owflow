import { describe, expect, test } from 'bun:test';
import { HookFailureTracker } from '../../../hooks/runtime/hook-failure-tracker.js';
import { HookEventName } from '../../../types/hook-types.js';

const EXPECTED_REPEAT_COUNT = 2;

describe('hook-failure-tracker (per-session failure counting)', () => {
  test('recordFailure increments per event/check/session key and getCount reports the count', () => {
    const tracker = new HookFailureTracker();
    const entry = { event: HookEventName.ToolExecuteBefore, checkKey: '/a.sh', sessionID: 'ses_1' };

    expect(tracker.recordFailure(entry)).toBe(1);
    expect(tracker.recordFailure(entry)).toBe(EXPECTED_REPEAT_COUNT);
    expect(tracker.getCount(entry)).toBe(EXPECTED_REPEAT_COUNT);
    expect(tracker.getCount({ event: HookEventName.ToolExecuteBefore, checkKey: '/a.sh', sessionID: 'ses_2' })).toBe(0);
    expect(tracker.getCount({ event: HookEventName.ChatMessage, checkKey: '/a.sh', sessionID: 'ses_1' })).toBe(0);
  });

  test('positional args and entry objects resolve the same key; missing sessionID defaults to global', () => {
    const tracker = new HookFailureTracker();

    tracker.recordFailure(HookEventName.ToolExecuteBefore, '/a.sh', 'ses_1');
    expect(tracker.getCount({ event: HookEventName.ToolExecuteBefore, checkKey: '/a.sh', sessionID: 'ses_1' })).toBe(1);

    // Empty or undefined sessionID falls back to the global bucket
    tracker.recordFailure(HookEventName.ToolExecuteBefore, '/b.sh', '');
    tracker.recordFailure(HookEventName.ToolExecuteBefore, '/b.sh', undefined);
    expect(tracker.getCount({ event: HookEventName.ToolExecuteBefore, checkKey: '/b.sh' })).toBe(EXPECTED_REPEAT_COUNT);
    expect(tracker.getCount(HookEventName.ToolExecuteBefore, '/b.sh')).toBe(EXPECTED_REPEAT_COUNT);
    expect(tracker.getCount(HookEventName.ToolExecuteBefore, '/b.sh', 'ses_9')).toBe(0);
  });

  test('recordSuccess resets the counter and clear() resets all keys', () => {
    const tracker = new HookFailureTracker();
    const entry = { event: HookEventName.Config, checkKey: '/c.sh', sessionID: 'ses_1' };

    tracker.recordFailure(entry);
    tracker.recordFailure(entry);
    expect(tracker.getCount(entry)).toBe(EXPECTED_REPEAT_COUNT);

    tracker.recordSuccess(entry);
    expect(tracker.getCount(entry)).toBe(0);

    tracker.recordFailure(entry);
    tracker.clear();
    expect(tracker.getCount(entry)).toBe(0);
  });
});
