import { afterAll, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildHookLogsBody, buildHookRunDetailBody } from '../../tui/hooks-dialogs-bodies.js';
import { HookRunState, type HookRunLogRecord } from '../../types/hook-types.js';
import { THEME, collectText, findScrollbox, hasScrollbox, makeLogRecord, makeSolid, noop, type FakeNode } from '../tui/primitives.js';

const SCROLLBOX_HEIGHT = 20;
const LONG_OUTPUT_LINES = 80;
const SCROLL_LOG_LINES = 150;
const MID_LOG_LINE_INDEX = 50;

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'owflow-dialogs-bodies-test-'));
const logFile = path.join(temporaryDirectory, 'logs.jsonl');

afterAll(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

const makeDetailRecord = (status: HookRunState, lines: string): HookRunLogRecord => {
  if (status === HookRunState.IDLE) {
    return makeLogRecord({ status, startedAt: 0, finishedAt: 0, durationMs: 0 });
  }
  return makeLogRecord({ status, stderr: lines, reason: status === HookRunState.FAILURE ? lines : undefined });
};

test('should render an identical centered detail body without logs for Idle, In progress, and Error', () => {
  const { runtime } = makeSolid();
  const lines = Array.from({ length: LONG_OUTPUT_LINES }, (_, index) => `output line ${index + 1}`).join('\n');
  const structures: string[][] = [];

  for (const status of [HookRunState.IDLE, HookRunState.PENDING, HookRunState.FAILURE] as const) {
    const detailBody = buildHookRunDetailBody({
      record: makeDetailRecord(status, lines),
      logFile,
      theme: THEME,
      solid: runtime,
      onShowLogs: noop,
      onClose: noop,
      totalRunsInSession: status === HookRunState.IDLE ? 0 : 1,
    }) as FakeNode;

    expect(detailBody.props.alignItems).toBe('center');
    expect(detailBody.props.justifyContent).toBe('center');
    expect(hasScrollbox(detailBody)).toBe(false);
    const detailText = collectText(detailBody);
    expect(detailText).not.toContain('output line 1');
    expect(detailText).toContain('View logs');
    structures.push(detailBody.children.map((child) => (typeof child === 'string' ? 'string' : child.tag)));
  }

  expect(structures[0]).toEqual(structures[1]);
  expect(structures[1]).toEqual(structures[2]);
});

test('should render logs bodies centered inside a focused scrollbox with bounded height', () => {
  const { runtime } = makeSolid();
  const lines = Array.from({ length: LONG_OUTPUT_LINES }, (_, index) => `output line ${index + 1}`).join('\n');

  for (const status of [HookRunState.PENDING, HookRunState.FAILURE] as const) {
    const logsBody = buildHookLogsBody({
      record: makeDetailRecord(status, lines),
      theme: THEME,
      solid: runtime,
      onClose: noop,
      maxHeight: SCROLLBOX_HEIGHT,
    }) as FakeNode;
    expect(logsBody.props.alignItems).toBe('center');
    expect(logsBody.props.justifyContent).toBe('center');

    const logsScrollbox = findScrollbox(logsBody);
    expect(logsScrollbox).toBeDefined();
    expect(logsScrollbox!.props.height).toBe(SCROLLBOX_HEIGHT);
    expect(logsScrollbox!.props.focused).toBe(true);
    const bodyNode = logsScrollbox!.children.at(0) as FakeNode;
    expect(bodyNode.props.textAlign).toBe('left');
    const logsText = collectText(logsScrollbox!);
    expect(logsText).toContain('output line 1');
    expect(logsText).toContain(`output line ${MID_LOG_LINE_INDEX}`);
  }
});

test('should render complete logs directly inside the native scrollbox element', () => {
  const { runtime } = makeSolid();
  const lines = Array.from({ length: SCROLL_LOG_LINES }, (_, index) => `log line ${index + 1}`);
  const body = buildHookLogsBody({
    record: makeLogRecord({ stdout: lines.join('\n') }),
    theme: THEME,
    solid: runtime,
    onClose: noop,
    maxHeight: SCROLLBOX_HEIGHT,
  }) as FakeNode;

  const scrollbox = findScrollbox(body);
  expect(scrollbox).toBeDefined();
  expect(scrollbox!.props.height).toBe(SCROLLBOX_HEIGHT);
  expect(scrollbox!.props.focused).toBe(true);

  const text = collectText(scrollbox!);
  expect(text).toContain('log line 1');
  expect(text).toContain(`log line ${MID_LOG_LINE_INDEX}`);
  expect(text).toContain(`log line ${SCROLL_LOG_LINES}`);
});
