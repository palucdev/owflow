import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { STATUS_DEBOUNCE_MS, StatusRecorder } from '../../../hooks/runtime/status-recorder.js';
import { HookEvent, HookRunState, type HookRunLogRecord } from '../../../types/hook-types.js';
import { removeScratchDirectory } from '../../fixtures/hooks/scratch-cleanup.js';

const EXPECTED_DEBOUNCE_MS = 50;
const BOUNDED_CAPACITY = 1000;
const CAPACITY_TEST_TIMEOUT_MS = 30_000;
const SCRATCH_ROOT = path.join(process.cwd(), '.test-scratch', 'status-recorder');

const makeRecord = (root: string, id: number): HookRunLogRecord => ({
  version: 1,
  runId: `run#${id}`,
  pid: 1,
  workspace: root,
  event: HookEvent.ToolExecuteBefore,
  hook: '/hook.sh',
  name: 'tool-execute-before',
  startedAt: 1000,
  finishedAt: 1010,
  durationMs: 10,
  status: HookRunState.SUCCESS,
});

type StatusRecorderInternals = { writtenRunRecords: Set<string> };

const getWrittenRunRecords = (recorder: StatusRecorder): Set<string> =>
  (recorder as unknown as StatusRecorderInternals).writtenRunRecords;

fs.rmSync(SCRATCH_ROOT, { recursive: true, force: true });
fs.mkdirSync(SCRATCH_ROOT, { recursive: true });

afterAll(() => {
  removeScratchDirectory(SCRATCH_ROOT);
});

describe('status-recorder (documented constants)', () => {
  test('exports the documented debounce constant', () => {
    expect(STATUS_DEBOUNCE_MS).toBe(EXPECTED_DEBOUNCE_MS);
  });
});

describe('status-recorder (run-record deduplication)', () => {
  test('dedupes identical runs by runId and status', () => {
    const root = path.join(SCRATCH_ROOT, 'dedupe');
    fs.mkdirSync(root, { recursive: true });
    const logFile = path.join(root, 'dedupe.jsonl');
    const recorder = new StatusRecorder({ directory: root, logFile });
    expect(recorder.getAllStatuses().size).toBe(0);

    recorder.appendLog(makeRecord(root, 0));
    // Appending duplicate run#0 with same status is deduped
    recorder.appendLog(makeRecord(root, 0));

    const set = getWrittenRunRecords(recorder);
    expect(set.size).toBe(1);
    expect(set.has('run#0:success')).toBe(true);

    recorder.dispose();
  });
});

describe('status-recorder (bounded run-record capacity)', () => {
  test('evicts oldest entries when capacity exceeds 1,000', () => {
    const root = path.join(SCRATCH_ROOT, 'evict');
    fs.mkdirSync(root, { recursive: true });
    const logFile = path.join(root, 'evict.jsonl');
    const recorder = new StatusRecorder({ directory: root, logFile });

    recorder.appendLog(makeRecord(root, 0));
    // Add 1,000 distinct records to exceed the 1,000 bounded capacity
    for (let index = 1; index <= BOUNDED_CAPACITY; index += 1) {
      recorder.appendLog(makeRecord(root, index));
    }

    const set = getWrittenRunRecords(recorder);
    expect(set.size).toBe(BOUNDED_CAPACITY);
    // run#0 was the oldest entry and was evicted
    expect(set.has('run#0:success')).toBe(false);
    // Recent runs are still tracked
    expect(set.has(`run#${BOUNDED_CAPACITY}:success`)).toBe(true);
    expect(set.has('run#1:success')).toBe(true);

    // run#1000 is still active in the set and should be deduped
    recorder.appendLog(makeRecord(root, BOUNDED_CAPACITY));
    expect(set.size).toBe(BOUNDED_CAPACITY);

    // run#0 was evicted, so appending it again re-adds it and evicts run#1
    recorder.appendLog(makeRecord(root, 0));
    expect(set.size).toBe(BOUNDED_CAPACITY);
    expect(set.has('run#0:success')).toBe(true);
    expect(set.has('run#1:success')).toBe(false);

    recorder.dispose();
  }, CAPACITY_TEST_TIMEOUT_MS);
});

describe('status-recorder (atomic status flush)', () => {
  test('flushStatusFileAtomic cleans up .tmp file when write or rename throws', () => {
    const root = path.join(SCRATCH_ROOT, 'atomic-flush');
    fs.mkdirSync(root, { recursive: true });
    const statusFile = path.join(root, 'atomic-status.json');
    const recorder = new StatusRecorder({ directory: root, statusFile });

    const renameSpy = spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('EACCES: mock rename failure');
    });

    try {
      recorder.flushStatusFileAtomic(statusFile, root, new Map());
      const temporaryFiles = fs.readdirSync(root).filter((file) => file.endsWith('.tmp'));
      expect(temporaryFiles).toHaveLength(0);
    } finally {
      renameSpy.mockRestore();
      recorder.dispose();
    }
  });
});

describe('status-recorder (in-memory snapshot entries)', () => {
  test('getStatus, setStatus, and deleteStatus manage in-memory snapshot entries', () => {
    const root = path.join(SCRATCH_ROOT, 'snapshot-entries');
    fs.mkdirSync(root, { recursive: true });
    const recorder = new StatusRecorder({ directory: root });

    expect(recorder.getStatus(HookEvent.ToolExecuteBefore)).toBeUndefined();
    recorder.setStatus(HookEvent.ToolExecuteBefore, { status: HookRunState.SUCCESS, startedAt: 1 });
    expect(recorder.getStatus(HookEvent.ToolExecuteBefore)?.status).toBe(HookRunState.SUCCESS);
    expect(recorder.getAllStatuses().size).toBe(1);

    recorder.deleteStatus(HookEvent.ToolExecuteBefore);
    expect(recorder.getStatus(HookEvent.ToolExecuteBefore)).toBeUndefined();

    recorder.dispose();
  });
});
