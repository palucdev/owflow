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

const recordThreeConsecutiveFailures = (
  tracker: CircuitBreakerTracker,
  now: number,
): {
  trippedUntil: number;
  rapidFailures: number;
} => {
  tracker.recordFailure({
    event: HookEvent.ToolExecuteBefore,
    scriptPath: '/test/hook.sh',
    sessionID: 'ses_1',
    startedAt: now + OFFSETS.twenty,
    finishedAt: now + OFFSETS.thirty,
  });

  tracker.recordFailure({
    event: HookEvent.ToolExecuteBefore,
    scriptPath: '/test/hook.sh',
    sessionID: 'ses_1',
    startedAt: now + OFFSETS.forty,
    finishedAt: now + OFFSETS.fifty,
  });

  return tracker.recordFailure({
    event: HookEvent.ToolExecuteBefore,
    scriptPath: '/test/hook.sh',
    sessionID: 'ses_1',
    startedAt: now + OFFSETS.sixty,
    finishedAt: now + OFFSETS.seventy,
  });
};

describe('circuit-breaker (rapid failure tripping and cooldown)', () => {
  test('CircuitBreakerTracker tracks, trips, resets on success, and clears', () => {
    const tracker = new CircuitBreakerTracker();
    expect(tracker.check({ event: HookEvent.ToolExecuteBefore, scriptPath: '/test/hook.sh', sessionID: 'ses_1' })).toEqual({ tripped: false });

    const now = Date.now();
    tracker.recordFailure({
      event: HookEvent.ToolExecuteBefore,
      scriptPath: '/test/hook.sh',
      sessionID: 'ses_1',
      startedAt: now,
      finishedAt: now + OFFSETS.ten,
    });
    expect(tracker.check({ event: HookEvent.ToolExecuteBefore, scriptPath: '/test/hook.sh', sessionID: 'ses_1' })).toEqual({ tripped: false });

    const result = recordThreeConsecutiveFailures(tracker, now);

    expect(result.rapidFailures).toBe(EXPECTED_BREAKER_THRESHOLD);
    expect(result.trippedUntil).toBeGreaterThan(0);

    const checkTripped = tracker.check({ event: HookEvent.ToolExecuteBefore, scriptPath: '/test/hook.sh', sessionID: 'ses_1' });
    expect(checkTripped.tripped).toBe(true);
    expect(checkTripped.reason).toContain('Circuit breaker active for /test/hook.sh');

    tracker.recordSuccess({ event: HookEvent.ToolExecuteBefore, scriptPath: '/test/hook.sh', sessionID: 'ses_1' });
    expect(tracker.check({ event: HookEvent.ToolExecuteBefore, scriptPath: '/test/hook.sh', sessionID: 'ses_1' })).toEqual({ tripped: false });

    tracker.recordFailure({
      event: HookEvent.ToolExecuteBefore,
      scriptPath: '/test/hook.sh',
      sessionID: 'ses_1',
      startedAt: now + OFFSETS.eighty,
      finishedAt: now + OFFSETS.ninety,
    });
    tracker.clear();
    expect(tracker.check({ event: HookEvent.ToolExecuteBefore, scriptPath: '/test/hook.sh', sessionID: 'ses_1' })).toEqual({ tripped: false });
  });

  test('keys are isolated per event, script, and session', () => {
    const tracker = new CircuitBreakerTracker();
    const now = Date.now();
    for (let index = 0; index < EXPECTED_BREAKER_THRESHOLD; index += 1) {
      tracker.recordFailure({
        event: HookEvent.ToolExecuteBefore,
        scriptPath: '/a.sh',
        sessionID: 'ses_1',
        startedAt: now + index * OFFSETS.ten,
        finishedAt: now + index * OFFSETS.ten + OFFSETS.five,
      });
    }
    expect(tracker.check({ event: HookEvent.ToolExecuteBefore, scriptPath: '/a.sh', sessionID: 'ses_1' }).tripped).toBe(true);
    expect(tracker.check({ event: HookEvent.ToolExecuteBefore, scriptPath: '/a.sh', sessionID: 'ses_2' }).tripped).toBe(false);
    expect(tracker.check({ event: HookEvent.ChatMessage, scriptPath: '/a.sh', sessionID: 'ses_1' }).tripped).toBe(false);
    expect(tracker.check({ event: HookEvent.ToolExecuteBefore, scriptPath: '/b.sh', sessionID: 'ses_1' }).tripped).toBe(false);
  });
});
