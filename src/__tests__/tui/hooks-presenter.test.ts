import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildActiveHooksView, colorForStatus, formatHookLogsMessage, formatHookRunSummary, statusLabelFor } from '../../tui/hooks-presenter.js';
import { THEME, makeLogRecord } from './primitives.js';
import { HookRunState } from '../../types/hook-types.js';

const TRUNCATED_SUMMARY_LIMIT = 40;
const EXPECTED_FIELD_LABELS = ['Event', 'Status', 'Time', 'Session', 'Exit'];

const workspace = { directory: '', hooksDirectory: '' };

beforeEach(() => {
  workspace.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'owflow-tui-formatting-test-'));
  workspace.hooksDirectory = path.join(workspace.directory, '.owflow', 'hooks');
  fs.mkdirSync(workspace.hooksDirectory, { recursive: true });
});

afterEach(() => {
  if (fs.existsSync(workspace.directory)) {
    fs.rmSync(workspace.directory, { recursive: true, force: true });
  }
});

const extractFieldLabels = (summary: string): string[] => summary.split('\n').map((line) => line.split(':', 1)[0] ?? '');

const expectErrorSummary = (summary: string): void => {
  expect(summary).toContain('Event:  tool.execute.before');
  expect(summary).toContain('Status: Error — 123 ms');
  expect(summary).toContain('Session: ses-123');
  expect(summary).toContain('Exit:   1');
  expect(summary).not.toContain('policy violation');
  expect(summary).not.toContain('secret stdout');
  expect(summary).not.toContain('secret stderr');
  expect(summary).not.toContain('\n\n');
};

const expectPendingSummary = (summary: string): void => {
  expect(summary).toContain('Status: In progress — 45 ms');
  expect(summary).toContain('Session: none');
  expect(summary).toContain('Exit:   none');
};

const expectIdleSummary = (summary: string): void => {
  expect(summary).toContain('Status: Idle — 0 ms');
  expect(summary).toContain('Time:   none');
  expect(summary).toContain('Session: none');
  expect(summary).toContain('Exit:   none');
};

describe('TUI hooks-presenter view', () => {
  test('buildActiveHooksView should return active hook rows from hooks directory', () => {
    fs.writeFileSync(path.join(workspace.hooksDirectory, 'tool-execute-before.sh'), '');
    fs.writeFileSync(path.join(workspace.hooksDirectory, 'config.sh'), '');

    const view = buildActiveHooksView(workspace.directory);
    expect(view.title).toBe('Active hooks:');
    expect(view.rows).toEqual([
      { name: 'config', event: 'config' },
      { name: 'tool-execute-before', event: 'tool.execute.before' },
    ]);
  });
});

describe('TUI hooks-presenter status mapping', () => {
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
});

describe('TUI hooks-presenter run summaries', () => {
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
    expectErrorSummary(errorSummary);

    const pendingSummary = formatHookRunSummary(makeLogRecord({ status: HookRunState.PENDING, durationMs: 45 }));
    expectPendingSummary(pendingSummary);

    const idleSummary = formatHookRunSummary(makeLogRecord({ status: HookRunState.IDLE, startedAt: 0, finishedAt: 0, durationMs: 0 }));
    expectIdleSummary(idleSummary);

    // Identical line count and field labels across Idle, In progress, and Error
    expect(extractFieldLabels(idleSummary)).toEqual(EXPECTED_FIELD_LABELS);
    expect(extractFieldLabels(pendingSummary)).toEqual(EXPECTED_FIELD_LABELS);
    expect(extractFieldLabels(errorSummary)).toEqual(EXPECTED_FIELD_LABELS);

    const truncated = formatHookRunSummary(errorRecord, TRUNCATED_SUMMARY_LIMIT);
    expect(truncated).toContain('[message truncated]');
    expect(truncated.length).toBeLessThanOrEqual(TRUNCATED_SUMMARY_LIMIT);
  });
});

describe('TUI hooks-presenter log messages', () => {
  test('formatHookLogsMessage should format stdout, stderr, reason, and empty outputs', () => {
    expect(formatHookLogsMessage(makeLogRecord())).toBe('No output captured for this run.');

    const record = makeLogRecord({ stdout: 'out-line 1\nout-line 2', stderr: 'err-line 1\nerr-line 2' });
    const message = formatHookLogsMessage(record);
    expect(message).toContain('--- stderr ---\nerr-line 1\nerr-line 2');
    expect(message).toContain('--- stdout ---\nout-line 1\nout-line 2');

    const reasonOnly = makeLogRecord({ status: HookRunState.FAILURE, reason: 'hook failed' });
    expect(formatHookLogsMessage(reasonOnly)).toBe('hook failed');
  });
});
