import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { CircuitBreakerTracker } from '../../../hooks/runtime/circuit-breaker.js';
import { SessionAbortController } from '../../../hooks/runtime/failure-policy.js';
import { StatusRecorder } from '../../../hooks/runtime/status-recorder.js';
import { executeHookRun, type HookRunDependencies } from '../../../hooks/wrapper/hook-run-executor.js';
import { HookEventName, HookRunState, type HookRegistryEntry } from '../../../types/hook-types.js';
import { removeScratchDirectory } from '../../fixtures/hooks/scratch-cleanup.js';
import { bashInterpreter } from '../../fixtures/hooks/platform-support.js';

const EXECUTABLE_MODE = 0o755;
const CIRCUIT_FAILURE_COUNT = 4;
const OFFSET_TEN_MS = 10;
const OFFSET_FIVE_MS = 5;
const SCRATCH_ROOT = path.join(process.cwd(), '.test-scratch', 'hook-run-executor');

const makeEntry = (scriptPath: string, isAvailable = true): HookRegistryEntry => ({
  path: scriptPath,
  event: HookEventName.ToolExecuteBefore,
  interpreter: { resolved: isAvailable ? (bashInterpreter ?? '/bin/bash') : undefined, expected: 'bash', available: isAvailable },
  status: 'registered',
});

const makeDependencies = (root: string, ended: string[]): HookRunDependencies => ({
  statusRecorder: new StatusRecorder({ directory: root }),
  abortController: new SessionAbortController((sessionID) => {
    ended.push(sessionID);
  }),
  circuitBreaker: new CircuitBreakerTracker(),
  activeProcesses: new Set<ReturnType<typeof Bun.spawn>>(),
  workspace: root,
});

interface RequestOptions {
  dependencies: HookRunDependencies;
  entry: HookRegistryEntry;
  overrides?: Partial<Parameters<typeof executeHookRun>[0]>;
}

const makeRequest = ({ dependencies, entry, overrides = {} }: RequestOptions): Parameters<typeof executeHookRun>[0] => ({
  dependencies,
  entry,
  event: entry.event,
  sessionID: 'ses_exec',
  stdinText: '{}',
  runId: 'test#1',
  startedAt: Date.now(),
  hookName: path.basename(entry.path, path.extname(entry.path)),
  ...overrides,
});

fs.rmSync(SCRATCH_ROOT, { recursive: true, force: true });
fs.mkdirSync(SCRATCH_ROOT, { recursive: true });

afterAll(() => {
  removeScratchDirectory(SCRATCH_ROOT);
});

describe('hook-run-executor (successful runs)', () => {
  test('successful run records SUCCESS status and leaves the circuit closed', async () => {
    const root = path.join(SCRATCH_ROOT, 'success-run');
    const ended: string[] = [];
    const dependencies = makeDependencies(root, ended);
    const hooksDirectory = path.join(root, '.owflow', 'hooks');
    fs.mkdirSync(hooksDirectory, { recursive: true });
    const scriptPath = path.join(hooksDirectory, 'tool-execute-before.sh');
    fs.writeFileSync(scriptPath, '#!/usr/bin/env bash\nexit 0\n', { mode: EXECUTABLE_MODE });
    const entry = makeEntry(scriptPath);

    await executeHookRun(makeRequest({ dependencies, entry }));

    expect(dependencies.statusRecorder.getStatus(HookEventName.ToolExecuteBefore)?.status).toBe(HookRunState.SUCCESS);
    expect(dependencies.circuitBreaker.check({ event: entry.event, scriptPath: entry.path }).tripped).toBe(false);
    expect(ended).toEqual([]);
  });

  test('silent successful event runs restore the previous status instead of recording SUCCESS', async () => {
    const root = path.join(SCRATCH_ROOT, 'silent-event');
    const ended: string[] = [];
    const dependencies = makeDependencies(root, ended);
    const hooksDirectory = path.join(root, '.owflow', 'hooks');
    fs.mkdirSync(hooksDirectory, { recursive: true });
    const scriptPath = path.join(hooksDirectory, 'event.sh');
    fs.writeFileSync(scriptPath, '#!/usr/bin/env bash\nexit 0\n', { mode: EXECUTABLE_MODE });
    const entry = makeEntry(scriptPath);

    await executeHookRun(makeRequest({ dependencies, entry, overrides: { event: HookEventName.Event, sessionID: undefined, hookName: 'event' } }));

    expect(dependencies.statusRecorder.getStatus(HookEventName.Event)).toBeUndefined();
    expect(ended).toEqual([]);
  });
});

describe('hook-run-executor (failing lifecycle-gate runs)', () => {
  test('failing lifecycle-gate run rejects with Blocked error, aborts the session, and records FAILURE', async () => {
    const root = path.join(SCRATCH_ROOT, 'failing-gate');
    const ended: string[] = [];
    const dependencies = makeDependencies(root, ended);
    const hooksDirectory = path.join(root, '.owflow', 'hooks');
    fs.mkdirSync(hooksDirectory, { recursive: true });
    const scriptPath = path.join(hooksDirectory, 'tool-execute-before.sh');
    fs.writeFileSync(scriptPath, '#!/usr/bin/env bash\necho "gate failed" >&2\nexit 2\n', { mode: EXECUTABLE_MODE });
    const entry = makeEntry(scriptPath);

    await expect(executeHookRun(makeRequest({ dependencies, entry }))).rejects.toThrow(/Blocked: gate failed\./);

    expect(dependencies.statusRecorder.getStatus(HookEventName.ToolExecuteBefore)?.status).toBe(HookRunState.FAILURE);
    expect(ended).toEqual(['ses_exec']);
  });

  test('unavailable interpreter rejects with a Blocked error and aborts the session', async () => {
    const root = path.join(SCRATCH_ROOT, 'unavailable-interpreter');
    const ended: string[] = [];
    const dependencies = makeDependencies(root, ended);
    const hooksDirectory = path.join(root, '.owflow', 'hooks');
    fs.mkdirSync(hooksDirectory, { recursive: true });
    const scriptPath = path.join(hooksDirectory, 'config.sh');
    fs.writeFileSync(scriptPath, '#!/usr/bin/env bash\nexit 0\n', { mode: EXECUTABLE_MODE });
    const entry = makeEntry(scriptPath, false);

    await expect(executeHookRun(makeRequest({ dependencies, entry, overrides: { event: HookEventName.Config } }))).rejects.toThrow(
      /bash interpreter is not available/,
    );
    expect(ended).toEqual(['ses_exec']);
  });
});

describe('hook-run-executor (open circuit)', () => {
  test('open circuit rejects with the circuit breaker error without spawning a process', async () => {
    const root = path.join(SCRATCH_ROOT, 'open-circuit');
    const ended: string[] = [];
    const dependencies = makeDependencies(root, ended);
    const hooksDirectory = path.join(root, '.owflow', 'hooks');
    fs.mkdirSync(hooksDirectory, { recursive: true });
    const scriptPath = path.join(hooksDirectory, 'tool-execute-before.sh');
    fs.writeFileSync(scriptPath, '#!/usr/bin/env bash\nexit 0\n', { mode: EXECUTABLE_MODE });
    const entry = makeEntry(scriptPath);

    const now = Date.now();
    for (let index = 0; index < CIRCUIT_FAILURE_COUNT; index += 1) {
      dependencies.circuitBreaker.recordFailure({
        event: entry.event,
        scriptPath: entry.path,
        sessionID: 'ses_exec',
        startedAt: now + index * OFFSET_TEN_MS,
        finishedAt: now + index * OFFSET_TEN_MS + OFFSET_FIVE_MS,
      });
    }

    const spawnSpy = spyOn(Bun, 'spawn');
    try {
      await expect(executeHookRun(makeRequest({ dependencies, entry }))).rejects.toThrow(/Blocked: Circuit breaker active/);
      expect(spawnSpy).not.toHaveBeenCalled();
    } finally {
      spawnSpy.mockRestore();
    }

    const status = dependencies.statusRecorder.getStatus(HookEventName.ToolExecuteBefore);
    expect(status?.status).toBe(HookRunState.FAILURE);
    expect(status?.reason).toContain('Circuit breaker active');
    expect(ended).toEqual([]);
  });
});
