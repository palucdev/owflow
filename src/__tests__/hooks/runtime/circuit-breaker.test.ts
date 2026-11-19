import { describe, expect, test } from 'bun:test';
import { CircuitBreakerTracker } from '../../../hooks/runtime/circuit-breaker.js';
import { HookEvent } from '../../../types/hook-types.js';

const EXPECTED_BREAKER_THRESHOLD = 4;
const OFFSETS = {
  five: 5,
  ten: 10,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
} as const;

describe('circuit-breaker (rapid failure tripping and cooldown)', () => {
  test('CircuitBreakerTracker tracks, trips, resets on success, and clears', () => {
    const tracker = new CircuitBreakerTracker();
    expect(tracker.check(HookEvent.ToolExecuteBefore, '/test/hook.sh', 'ses_1')).toEqual({ tripped: false });

    const now = Date.now();
    tracker.recordFailure(HookEvent.ToolExecuteBefore, '/test/hook.sh', 'ses_1', now, now + OFFSETS.ten);
    expect(tracker.check(HookEvent.ToolExecuteBefore, '/test/hook.sh', 'ses_1')).toEqual({ tripped: false });

    tracker.recordFailure(HookEvent.ToolExecuteBefore, '/test/hook.sh', 'ses_1', now + OFFSETS.twenty, now + OFFSETS.thirty);
    tracker.recordFailure(HookEvent.ToolExecuteBefore, '/test/hook.sh', 'ses_1', now + OFFSETS.forty, now + OFFSETS.fifty);
    const result = tracker.recordFailure(HookEvent.ToolExecuteBefore, '/test/hook.sh', 'ses_1', now + OFFSETS.sixty, now + OFFSETS.seventy);
    expect(result.rapidFailures).toBe(EXPECTED_BREAKER_THRESHOLD);
    expect(result.trippedUntil).toBeGreaterThan(0);

    const checkTripped = tracker.check(HookEvent.ToolExecuteBefore, '/test/hook.sh', 'ses_1');
    expect(checkTripped.tripped).toBe(true);
    expect(checkTripped.reason).toContain('Circuit breaker active for /test/hook.sh');

    tracker.recordSuccess(HookEvent.ToolExecuteBefore, '/test/hook.sh', 'ses_1');
    expect(tracker.check(HookEvent.ToolExecuteBefore, '/test/hook.sh', 'ses_1')).toEqual({ tripped: false });

    tracker.recordFailure(HookEvent.ToolExecuteBefore, '/test/hook.sh', 'ses_1', now + OFFSETS.eighty, now + OFFSETS.ninety);
    tracker.clear();
    expect(tracker.check(HookEvent.ToolExecuteBefore, '/test/hook.sh', 'ses_1')).toEqual({ tripped: false });
  });

  test('keys are isolated per event, script, and session', () => {
    const tracker = new CircuitBreakerTracker();
    const now = Date.now();
    for (let index = 0; index < EXPECTED_BREAKER_THRESHOLD; index += 1) {
      tracker.recordFailure(HookEvent.ToolExecuteBefore, '/a.sh', 'ses_1', now + index * OFFSETS.ten, now + index * OFFSETS.ten + OFFSETS.five);
    }
    expect(tracker.check(HookEvent.ToolExecuteBefore, '/a.sh', 'ses_1').tripped).toBe(true);
    expect(tracker.check(HookEvent.ToolExecuteBefore, '/a.sh', 'ses_2').tripped).toBe(false);
    expect(tracker.check(HookEvent.ChatMessage, '/a.sh', 'ses_1').tripped).toBe(false);
    expect(tracker.check(HookEvent.ToolExecuteBefore, '/b.sh', 'ses_1').tripped).toBe(false);
  });
});
