import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildActiveHooksView,
  colorForStatus,
  formatHookLogsMessage,
  formatHookRunSummary,
  formatSessionHookLogsMessage,
  statusLabelFor,
} from '../../tui/hooks-formatting.js';
import { THEME, makeLogRecord } from './primitives.js';
import { HookRunState } from '../../types/hook-types.js';

describe('TUI hook-formatting', () => {
  let tmpDir: string;
  let hooksDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'owflow-tui-formatting-test-'));
    hooksDir = path.join(tmpDir, '.owflow', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('buildActiveHooksView should return active hook rows from hooks directory', () => {
    fs.writeFileSync(path.join(hooksDir, 'tool-execute-before.sh'), '');
    fs.writeFileSync(path.join(hooksDir, 'config.sh'), '');

    const view = buildActiveHooksView(tmpDir);
    expect(view.title).toBe('Active hooks:');
    expect(view.rows).toEqual([
      { name: 'config', event: 'config' },
      { name: 'tool-execute-before', event: 'tool.execute.before' },
    ]);
  });

  test('statusLabelFor and colorForStatus should map states to labels and theme colors', () => {
    expect(statusLabelFor(HookRunState.IDLE)).toBe('Idle');
    expect(statusLabelFor(HookRunState.PENDING)).toBe('In progress');
    expect(statusLabelFor(HookRunState.SUCCESS)).toBe('Success');
    expect(statusLabelFor(HookRunState.FAILURE)).toBe('Error');
    expect(statusLabelFor(undefined)).toBe('Idle');

    expect(colorForStatus(HookRunState.IDLE, THEME)).toBe('muted-color');
    expect(colorForStatus(HookRunState.PENDING, THEME)).toBe('warning-color');
    expect(colorForStatus(HookRunState.SUCCESS, THEME)).toBe('success-color');
    expect(colorForStatus(HookRunState.FAILURE, THEME)).toBe('error-color');
    expect(colorForStatus(undefined, THEME)).toBe('muted-color');
  });

  test('formatHookRunSummary should format identical run metadata structure without logs across states', () => {
    const errorRecord = makeLogRecord({
      status: HookRunState.FAILURE,
      exitCode: 1,
      reason: 'policy violation',
      stdout: 'secret stdout',
      stderr: 'secret stderr',
      sessionID: 'ses-123',
    });
    const errorSummary = formatHookRunSummary(errorRecord);
    expect(errorSummary).toContain('Event:  tool.execute.before');
    expect(errorSummary).toContain('Status: Error — 123 ms');
    expect(errorSummary).toContain('Session: ses-123');
    expect(errorSummary).toContain('Exit:   1');
    expect(errorSummary).not.toContain('policy violation');
    expect(errorSummary).not.toContain('secret stdout');
    expect(errorSummary).not.toContain('secret stderr');
    expect(errorSummary).not.toContain('\n\n');

    const pendingSummary = formatHookRunSummary(makeLogRecord({ status: HookRunState.PENDING, durationMs: 45 }));
    expect(pendingSummary).toContain('Status: In progress — 45 ms');
    expect(pendingSummary).toContain('Session: none');
    expect(pendingSummary).toContain('Exit:   none');

    const idleSummary = formatHookRunSummary(makeLogRecord({ status: HookRunState.IDLE, startedAt: 0, finishedAt: 0, durationMs: 0 }));
    expect(idleSummary).toContain('Status: Idle — 0 ms');
    expect(idleSummary).toContain('Time:   none');
    expect(idleSummary).toContain('Session: none');
    expect(idleSummary).toContain('Exit:   none');

    // Identical line count and field labels across Idle, In progress, and Error
    const labels = (s: string) => s.split('\n').map((line) => line.split(':')[0]);
    expect(labels(idleSummary)).toEqual(['Event', 'Status', 'Time', 'Session', 'Exit']);
    expect(labels(pendingSummary)).toEqual(['Event', 'Status', 'Time', 'Session', 'Exit']);
    expect(labels(errorSummary)).toEqual(['Event', 'Status', 'Time', 'Session', 'Exit']);

    const truncated = formatHookRunSummary(errorRecord, 40);
    expect(truncated).toContain('[message truncated]');
    expect(truncated.length).toBeLessThanOrEqual(40);
  });

  test('formatHookLogsMessage and formatSessionHookLogsMessage should format outputs', () => {
    // Empty output
    expect(formatHookLogsMessage(makeLogRecord())).toBe('No output captured for this run.');

    // Captured stdout & stderr
    const record = makeLogRecord({ stdout: 'out-line', stderr: 'err-line' });
    const message = formatHookLogsMessage(record);
    expect(message).toContain('--- stdout ---\nout-line');
    expect(message).toContain('--- stderr ---\nerr-line');

    // Multiple session records including pending
    const record2 = makeLogRecord({
      status: HookRunState.FAILURE,
      stderr: 'second-err',
    });
    const record3 = makeLogRecord({
      status: HookRunState.PENDING,
      stdout: 'pending-out',
    });
    const sessionMsg = formatSessionHookLogsMessage([record, record2, record3]);
    expect(sessionMsg).toContain('=== Run #1');
    expect(sessionMsg).toContain('=== Run #2');
    expect(sessionMsg).toContain('=== Run #3');
    expect(sessionMsg).toContain('In progress');
    expect(sessionMsg).toContain('second-err');
    expect(sessionMsg).toContain('pending-out');
  });
});
