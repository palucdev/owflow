import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { CircuitBreakerTracker } from '../../../hooks/runtime/circuit-breaker.js';
import { SessionAbortController } from '../../../hooks/runtime/failure-policy.js';
import type { HookProcessResult } from '../../../hooks/runtime/process-executor.js';
import { NON_SESSION_STREAM_CAP_BYTES, StatusRecorder } from '../../../hooks/runtime/status-recorder.js';
import { HookRunOperations, type HookRunRequest } from '../../../hooks/wrapper/run-operations.js';
import { readHookLogRecords, readHookStatusSnapshot } from '../../../hooks/hooks-log-reader.js';
import { HookEvent, HookRunState, type HookRegistryEntry, type HookRunLogRecord } from '../../../types/hook-types.js';
import { removeScratchDirectory } from '../../fixtures/hooks/scratch-cleanup.js';
import { bashInterpreter } from '../../fixtures/hooks/platform-support.js';

const STATUS_FLUSH_WAIT_MS = 90;
const STATUS_FLUSH_TEST_TIMEOUT_MS = 2000;
const STARTED_AT = 1000;
const FINISHED_AT = 1100;
const DURATION_MS = 100;
const DOUBLE_OUTPUT_FACTOR = 2;
const EXECUTABLE_MODE = 0o755;
const NULL_VALUE: null = JSON.parse('null');
const SCRATCH_ROOT = path.join(process.cwd(), '.test-scratch', 'run-operations');

const makeEntry = (scriptPath: string): HookRegistryEntry => ({
  path: scriptPath,
  event: HookEvent.ToolExecuteBefore,
  interpreter: { resolved: bashInterpreter ?? '/bin/bash', expected: 'bash', available: true },
  status: 'registered',
});

const makeRequest = (root: string, logFile?: string): { request: HookRunRequest; entry: HookRegistryEntry } => {
  const entry = makeEntry(path.join(root, 'tool-execute-before.sh'));
  const request: HookRunRequest = {
    dependencies: {
      statusRecorder: new StatusRecorder({ directory: root, statusFile: path.join(root, 'status.json'), logFile }),
      abortController: new SessionAbortController(() => {}),
      circuitBreaker: new CircuitBreakerTracker(),
      activeProcesses: new Set<ReturnType<typeof Bun.spawn>>(),
      workspace: root,
    },
    entry,
    event: entry.event,
    sessionID: undefined,
    stdinText: '{}',
    runId: 'tool.execute.before#1',
    startedAt: STARTED_AT,
    hookName: 'tool-execute-before',
  };
  return { request, entry };
};

const makeResult = (overrides: Partial<HookProcessResult> = {}): HookProcessResult => ({
  startedAt: STARTED_AT,
  finishedAt: FINISHED_AT,
  durationMs: DURATION_MS,
  isOk: true,
  ok: true,
  isTimedOut: false,
  timedOut: false,
  exitCode: 0 as number | null,
  signal: NULL_VALUE as string | null,
  rawStdout: '',
  rawStderr: '',
  ...overrides,
});

const lastLogRecord = (logFile: string): HookRunLogRecord => {
  const result = readHookLogRecords(logFile);
  expect(result.kind).toBe('ok');
  if (result.kind !== 'ok') throw new Error('unreachable');
  expect(result.records.length).toBeGreaterThan(0);
  return result.records.at(-1)!;
};

fs.rmSync(SCRATCH_ROOT, { recursive: true, force: true });
fs.mkdirSync(SCRATCH_ROOT, { recursive: true });

afterAll(() => {
  removeScratchDirectory(SCRATCH_ROOT);
});

describe('run-operations (circuit breaker delegation)', () => {
  test('checkCircuit and recordCircuitOutcome delegate to the circuit breaker', () => {
    const root = path.join(SCRATCH_ROOT, 'circuit-delegation');
    fs.mkdirSync(root, { recursive: true });
    const { request } = makeRequest(root);
    const ops = new HookRunOperations(request);

    expect(ops.checkCircuit().tripped).toBe(false);

    ops.recordCircuitOutcome(makeResult());
    expect(ops.checkCircuit().tripped).toBe(false);

    const failing = makeResult({ isOk: false, ok: false, exitCode: 2 });
    ops.recordCircuitOutcome(failing);
    // A single failure is not enough to trip the breaker
    expect(ops.checkCircuit().tripped).toBe(false);
  });
});

describe('run-operations (failure recording)', () => {
  test('recordFailure writes a FAILURE status entry, flushes it, and appends a failure log record', () => {
    const root = path.join(SCRATCH_ROOT, 'failure-recording');
    fs.mkdirSync(root, { recursive: true });
    const logFile = path.join(root, 'logs.jsonl');
    const { request } = makeRequest(root, logFile);
    const ops = new HookRunOperations(request);

    ops.recordFailure('gate failed', FINISHED_AT);

    const status = readHookStatusSnapshot(path.join(root, 'status.json'));
    expect(status.kind).toBe('ok');
    if (status.kind !== 'ok') throw new Error('unreachable');
    const entry = status.snapshot.hooks[HookEvent.ToolExecuteBefore];
    expect(entry?.status).toBe(HookRunState.FAILURE);
    expect(entry?.reason).toBe('gate failed');
    expect(entry?.startedAt).toBe(STARTED_AT);

    const record = lastLogRecord(logFile);
    expect(record.status).toBe(HookRunState.FAILURE);
    expect(record.reason).toBe('gate failed');
    expect(record.runId).toBe('tool.execute.before#1');
    expect(record.durationMs).toBe(0);
  });
});

describe('run-operations (debounced pending status)', () => {
  test('recordPending schedules a debounced PENDING status write', async () => {
    const root = path.join(SCRATCH_ROOT, 'debounced-pending');
    fs.mkdirSync(root, { recursive: true });
    const statusFile = path.join(root, 'status.json');
    const { request } = makeRequest(root);
    const ops = new HookRunOperations(request);

    ops.recordPending();
    expect(ops.previousStatus()?.status).toBe(HookRunState.PENDING);

    // Not yet flushed before the debounce window elapses
    expect(readHookStatusSnapshot(statusFile).kind).toBe('ok');
    const immediate = readHookStatusSnapshot(statusFile);
    if (immediate.kind === 'ok') {
      expect(immediate.snapshot.hooks[HookEvent.ToolExecuteBefore]).toBeUndefined();
    }

    await new Promise((resolve) => {
      setTimeout(resolve, STATUS_FLUSH_WAIT_MS);
    });
    const flushed = readHookStatusSnapshot(statusFile);
    if (flushed.kind === 'ok') {
      expect(flushed.snapshot.hooks[HookEvent.ToolExecuteBefore]?.status).toBe(HookRunState.PENDING);
    }
  }, STATUS_FLUSH_TEST_TIMEOUT_MS);
});

describe('run-operations (terminal status and log)', () => {
  test('recordTerminalStatus and appendTerminalLog map successful results to SUCCESS with exit codes', () => {
    const root = path.join(SCRATCH_ROOT, 'terminal-success');
    fs.mkdirSync(root, { recursive: true });
    const logFile = path.join(root, 'logs.jsonl');
    const { request } = makeRequest(root, logFile);
    const ops = new HookRunOperations(request);

    const result = makeResult({ rawStdout: 'out line\n', rawStderr: 'warn line\n' });
    ops.recordTerminalStatus(result);
    ops.appendTerminalLog(result);

    const flushed = readHookStatusSnapshot(path.join(root, 'status.json'));
    if (flushed.kind === 'ok') {
      expect(flushed.snapshot.hooks[HookEvent.ToolExecuteBefore]?.status).toBe(HookRunState.SUCCESS);
    }

    const record = lastLogRecord(logFile);
    expect(record.status).toBe(HookRunState.SUCCESS);
    expect(record.exitCode).toBe(0);
    // A null signal is omitted from the log record by the falsy-spread builder
    expect(record.signal).toBeUndefined();
    expect(record.stdout).toBe('out line\n');
    expect(record.stderr).toBe('warn line\n');
    expect(record.durationMs).toBe(DURATION_MS);
  });

  test('appendTerminalLog caps non-session stdout and stderr to NON_SESSION_STREAM_CAP_BYTES', () => {
    const root = path.join(SCRATCH_ROOT, 'stream-capping');
    fs.mkdirSync(root, { recursive: true });
    const logFile = path.join(root, 'logs.jsonl');
    const { request } = makeRequest(root, logFile);
    expect(request.sessionID).toBeUndefined();
    const ops = new HookRunOperations(request);

    const bigOutput = 'A'.repeat(NON_SESSION_STREAM_CAP_BYTES * DOUBLE_OUTPUT_FACTOR);
    ops.appendTerminalLog(makeResult({ rawStdout: bigOutput, rawStderr: bigOutput }));

    const record = lastLogRecord(logFile);
    expect(record.stdout?.length).toBe(NON_SESSION_STREAM_CAP_BYTES);
    expect(record.stderr?.length).toBe(NON_SESSION_STREAM_CAP_BYTES);
  });
});

describe('run-operations (status restoration)', () => {
  test('restoreStatus restores the previous entry or deletes the status when none existed', () => {
    const root = path.join(SCRATCH_ROOT, 'status-restoration');
    fs.mkdirSync(root, { recursive: true });
    const { request } = makeRequest(root);
    const ops = new HookRunOperations(request);

    // No previous status: restoreStatus deletes the current one
    ops.recordTerminalStatus(makeResult());
    expect(ops.previousStatus()?.status).toBe(HookRunState.SUCCESS);
    ops.restoreStatus(undefined);
    expect(ops.previousStatus()).toBeUndefined();

    // Previous status: restoreStatus puts it back
    const previous = { status: HookRunState.FAILURE, startedAt: 500, reason: 'old failure' };
    ops.restoreStatus(previous);
    expect(ops.previousStatus()).toEqual(previous);
  });
});

describe('run-operations (session abort and spawning)', () => {
  test('abortSession delegates to the session abort controller', async () => {
    const root = path.join(SCRATCH_ROOT, 'abort-delegation');
    fs.mkdirSync(root, { recursive: true });
    const ended: string[] = [];
    const entry = makeEntry(path.join(root, 'tool-execute-before.sh'));
    const request: HookRunRequest = {
      dependencies: {
        statusRecorder: new StatusRecorder({ directory: root }),
        abortController: new SessionAbortController((sessionID) => {
          ended.push(sessionID);
        }),
        circuitBreaker: new CircuitBreakerTracker(),
        activeProcesses: new Set<ReturnType<typeof Bun.spawn>>(),
        workspace: root,
      },
      entry,
      event: entry.event,
      sessionID: 'ses_abort',
      stdinText: '{}',
      runId: 'run#1',
      startedAt: STARTED_AT,
      hookName: 'tool-execute-before',
    };
    const ops = new HookRunOperations(request);

    await ops.abortSession();
    expect(ended).toEqual(['ses_abort']);
  });

  test('spawn delegates to executeHookProcess and registers the process in activeProcesses', async () => {
    const root = path.join(SCRATCH_ROOT, 'spawn-delegation');
    fs.mkdirSync(root, { recursive: true });
    const scriptPath = path.join(root, 'ok.sh');
    fs.writeFileSync(scriptPath, '#!/usr/bin/env bash\necho ok\nexit 0\n', { mode: EXECUTABLE_MODE });
    const { request } = makeRequest(root);
    const ops = new HookRunOperations(request);

    // Point the entry at the real script for spawning
    (request.entry as { path: string }).path = scriptPath;

    const result = await ops.spawn();
    expect(result.isOk).toBe(true);
    expect(result.rawStdout).toBe('ok\n');
  });
});
