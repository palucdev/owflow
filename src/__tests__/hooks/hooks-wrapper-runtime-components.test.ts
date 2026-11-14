import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import path from 'node:path';
import {
  CircuitBreakerTracker,
  HookSpawnError,
  SessionAbortController,
  StatusRecorder,
  buildCircuitBreakerError,
  buildInterpreterUnavailableError,
  buildProcessFailureError,
  buildSpawnError,
  executeHookProcess,
} from '../../hooks/hooks-wrapper.js';
import { CIRCUIT_BREAKER_THRESHOLD } from '../../hooks/runtime/circuit-breaker.js';
import { HookEvent, HookRunState, type HookRegistryEntry } from '../../types/hook-types.js';
import { cleanupWorkspaces, createLogRecord, createWorkspace } from './hooks-test-helpers.js';

const SESSION_ID = 'ses_1';
const SCRIPT_PATH = '/test/hook.sh';
const BASE_TIME = 1000;
const TIME_STEP = 10;
const MAX_RUN_RECORDS = 1000;

const createInvocation = (now: number) => ({
  event: HookEvent.ToolExecuteBefore,
  scriptPath: SCRIPT_PATH,
  sessionID: SESSION_ID,
  now,
  startedAt: now,
  finishedAt: now,
});

const expectRetained = (
  writtenRecords: Set<string>,
  expectations: { readonly size: number; readonly present: readonly string[]; readonly absent: readonly string[] },
): void => {
  expect(writtenRecords.size).toBe(expectations.size);
  for (const key of expectations.present) expect(writtenRecords.has(key)).toBe(true);
  for (const key of expectations.absent) expect(writtenRecords.has(key)).toBe(false);
};

const createRegistryEntry = (workspace: string): HookRegistryEntry => ({
  path: path.join(workspace, 'nonexistent.sh'),
  event: HookEvent.ToolExecuteBefore,
  interpreter: {
    resolved: '/nonexistent/interpreter',
    expected: 'bash',
    available: false,
  },
  status: 'registered',
});

afterEach(cleanupWorkspaces);

describe('CircuitBreakerTracker', () => {
  test('tracks, trips, resets on success, and clears', () => {
    const tracker = new CircuitBreakerTracker();
    let now = BASE_TIME;
    const advance = (): number => {
      now += TIME_STEP;
      return now;
    };
    const nextInvocation = () => createInvocation(advance());

    expect(tracker.check(nextInvocation())).toEqual({ tripped: false });

    tracker.recordFailure(nextInvocation());
    expect(tracker.check(nextInvocation())).toEqual({ tripped: false });

    tracker.recordFailure(nextInvocation());
    tracker.recordFailure(nextInvocation());
    const result = tracker.recordFailure(nextInvocation());
    expect(result.rapidFailures).toBe(CIRCUIT_BREAKER_THRESHOLD);
    expect(result.trippedUntil).toBeGreaterThan(0);

    const trippedCheck = tracker.check(nextInvocation());
    expect(trippedCheck.tripped).toBe(true);
    expect(trippedCheck.reason).toContain(`Circuit breaker active for ${SCRIPT_PATH}`);

    tracker.recordSuccess({ event: HookEvent.ToolExecuteBefore, scriptPath: SCRIPT_PATH, sessionID: SESSION_ID });
    expect(tracker.check(nextInvocation())).toEqual({ tripped: false });

    tracker.recordFailure(nextInvocation());
    tracker.clear();
    expect(tracker.check(nextInvocation())).toEqual({ tripped: false });
  });
});

describe('SessionAbortController', () => {
  test('manages cooldown, session clearing, and disposal', async () => {
    const abortedSessions: string[] = [];
    const controller = new SessionAbortController((sessionID) => {
      abortedSessions.push(sessionID);
    });
    const abortOptions = {
      event: HookEvent.ToolExecuteBefore,
      sessionID: 'ses_abc',
      scriptPath: '/path/to/script.sh',
    };

    await controller.abortSession(abortOptions);
    expect(abortedSessions).toEqual(['ses_abc']);

    // Within cooldown, second abort is suppressed
    await controller.abortSession(abortOptions);
    expect(abortedSessions).toEqual(['ses_abc']);

    // Clearing session cooldown allows another abort
    controller.clearSession('ses_abc');
    await controller.abortSession(abortOptions);
    expect(abortedSessions).toEqual(['ses_abc', 'ses_abc']);

    controller.dispose();
  });
});

describe('StatusRecorder deduplication', () => {
  test('dedupes identical runs and evicts oldest entries when capacity exceeds 1,000', () => {
    const workspace = createWorkspace('owflow-wrapper-unit-');
    const logFile = path.join(workspace, 'evict.jsonl');
    const recorder = new StatusRecorder({ directory: workspace, logFile });
    expect(recorder.getAllStatuses().size).toBe(0);

    const makeRecord = (id: number) =>
      createLogRecord({
        workspace,
        runId: `run#${id}`,
        hook: '/hook.sh',
        status: HookRunState.SUCCESS,
      });

    recorder.appendLog(makeRecord(0));
    recorder.appendLog(makeRecord(0));

    const writtenRunRecords = (recorder as unknown as { writtenRunRecords: Set<string> }).writtenRunRecords;
    expectRetained(writtenRunRecords, { size: 1, present: ['run#0:success'], absent: [] });

    for (let index = 1; index <= MAX_RUN_RECORDS; index += 1) {
      recorder.appendLog(makeRecord(index));
    }

    expectRetained(writtenRunRecords, {
      size: MAX_RUN_RECORDS,
      present: ['run#1000:success', 'run#1:success'],
      absent: ['run#0:success'],
    });

    recorder.appendLog(makeRecord(MAX_RUN_RECORDS));
    expectRetained(writtenRunRecords, { size: MAX_RUN_RECORDS, present: [], absent: [] });

    recorder.appendLog(makeRecord(0));
    expectRetained(writtenRunRecords, {
      size: MAX_RUN_RECORDS,
      present: ['run#0:success'],
      absent: ['run#1:success'],
    });

    recorder.dispose();
  });
});

describe('executeHookProcess spawn failures', () => {
  test('throws HookSpawnError when process cannot be spawned', async () => {
    const workspace = createWorkspace('owflow-wrapper-unit-');
    const entry = createRegistryEntry(workspace);
    const spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
      throw new Error('ENOENT: spawn failed');
    });

    try {
      await expect(
        executeHookProcess({
          entry,
          directory: workspace,
          stdinText: '{}',
          event: HookEvent.ToolExecuteBefore,
        }),
      ).rejects.toBeInstanceOf(HookSpawnError);
    } finally {
      spawnSpy.mockRestore();
    }
  });
});

describe('hook error builders', () => {
  test('generate expected Blocked error messages and hints', () => {
    const circuitBreakerError = buildCircuitBreakerError('/path/hook.sh', 'too many failures');
    expect(circuitBreakerError.message).toBe('Blocked: too many failures. Hint: fix /path/hook.sh or wait for cooldown.');

    const interpreterError = buildInterpreterUnavailableError('/path/hook.sh', 'pwsh');
    expect(interpreterError.message).toContain('the pwsh interpreter is not available');

    const spawnError = buildSpawnError({
      scriptPath: '/path/hook.sh',
      spawnErrorMessage: 'permission denied',
      event: HookEvent.ToolExecuteBefore,
    });
    expect(spawnError.message).toContain('failed to spawn hook /path/hook.sh: permission denied');
    expect(spawnError.message).toContain('failure ends the current session; fail closed');

    const processError = buildProcessFailureError({
      scriptPath: '/path/hook.sh',
      reason: 'exit 1',
      event: HookEvent.ToolExecuteBefore,
    });
    expect(processError.message).toContain('Blocked: exit 1. Hint: fix the failing script');

    const nonAbortProcessError = buildProcessFailureError({
      scriptPath: '/path/hook.sh',
      reason: 'exit 1',
      event: 'session.idle',
    });
    expect(nonAbortProcessError.message).toContain('failure recorded; fail closed');
  });
});
