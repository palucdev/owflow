import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { buildActiveHooksView, colorForStatus, formatHookLogsMessage, formatHookRunSummary, statusLabelFor } from '../../tui/hooks-presenter.js';
import { HookEventName, HookRunState, type HookRunLogRecord } from '../../types/hook-types.js';
import { THEME, makeLogRecord } from './primitives.js';
import { createWorkspaceHarness } from './workspace.js';

const TRUNCATION_LIMIT = 40;

const workspaceHarness = createWorkspaceHarness('tui-formatting');

const makeErrorLogRecord = (): HookRunLogRecord =>
  makeLogRecord({
    status: HookRunState.FAILURE,
    exitCode: 1,
    reason: 'policy violation',
    stdout: 'secret stdout',
    stderr: 'secret stderr',
    sessionID: 'ses-123',
  });

beforeEach(() => {
  workspaceHarness.setup();
});

afterEach(() => {
  workspaceHarness.teardown();
});

test('buildActiveHooksView should return active hook rows from the hooks directory', () => {
  const { temporaryDirectory, hooksDirectory } = workspaceHarness.workspace();
  fs.writeFileSync(path.join(hooksDirectory, 'tool-execute-before.sh'), '');
  fs.writeFileSync(path.join(hooksDirectory, 'config.sh'), '');

  const view = buildActiveHooksView(temporaryDirectory);
  expect(view.title).toBe('Active hooks:');
  expect(view.rows).toEqual([
    { name: 'config', event: HookEventName.Config },
    { name: 'tool-execute-before', event: HookEventName.ToolExecuteBefore },
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

test('formatHookRunSummary should format an error run without leaking logs or the failure reason', () => {
  const errorSummary = formatHookRunSummary(makeErrorLogRecord());
  expect(errorSummary).toBe(
    ['Event:  tool.execute.before', 'Status: Error — 123 ms', 'Time:   1970-01-01T00:00:01.123Z', 'Session: ses-123', 'Exit:   1'].join('\n'),
  );
  expect(errorSummary).not.toContain('policy violation');
  expect(errorSummary).not.toContain('secret stdout');
  expect(errorSummary).not.toContain('secret stderr');
  expect(errorSummary).not.toContain('\n\n');
});

test('formatHookRunSummary should format a pending run with none placeholders', () => {
  const pendingSummary = formatHookRunSummary(makeLogRecord({ status: HookRunState.PENDING, durationMs: 45 }));
  expect(pendingSummary).toBe(
    ['Event:  tool.execute.before', 'Status: In progress — 45 ms', 'Time:   1970-01-01T00:00:01.123Z', 'Session: none', 'Exit:   none'].join('\n'),
  );
});

test('formatHookRunSummary should format an idle run without timestamps', () => {
  const idleSummary = formatHookRunSummary(makeLogRecord({ status: HookRunState.IDLE, startedAt: 0, finishedAt: 0, durationMs: 0 }));
  expect(idleSummary).toBe(
    ['Event:  tool.execute.before', 'Status: Idle — 0 ms', 'Time:   none', 'Session: none', 'Exit:   none'].join('\n'),
  );
});

test('formatHookRunSummary should truncate the message to the requested character limit', () => {
  const truncated = formatHookRunSummary(makeErrorLogRecord(), TRUNCATION_LIMIT);
  expect(truncated).toContain('[message truncated]');
  expect(truncated.length).toBeLessThanOrEqual(TRUNCATION_LIMIT);
});

test('formatHookLogsMessage should format stdout, stderr, reason, and empty outputs', () => {
  expect(formatHookLogsMessage(makeLogRecord())).toBe('No output captured for this run.');

  const record = makeLogRecord({ stdout: 'out-line 1\nout-line 2', stderr: 'err-line 1\nerr-line 2' });
  const message = formatHookLogsMessage(record);
  expect(message).toContain('--- stderr ---\nerr-line 1\nerr-line 2');
  expect(message).toContain('--- stdout ---\nout-line 1\nout-line 2');

  const reasonOnly = makeLogRecord({ status: HookRunState.FAILURE, reason: 'hook failed' });
  expect(formatHookLogsMessage(reasonOnly)).toBe('hook failed');
});
