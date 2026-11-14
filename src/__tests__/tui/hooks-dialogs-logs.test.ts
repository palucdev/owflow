import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import path from 'node:path';
import { buildHookLogsBody } from '../../tui/hooks-dialogs.js';
import { HookEvent, HookRunState } from '../../types/hook-types.js';
import {
  cleanupDialogWorkspaces,
  clickLabelledNode,
  clickNode,
  createDialogWorkspace,
  hoverNode,
  registerSidebar,
  renderSidebar,
  writeHookFile,
  writeLogRecord,
  writeStatusSnapshot,
} from './dialogs-test-helpers.js';
import { THEME, collectText, findClickableByContent, makeLogRecord, makeSolid, type FakeNode } from './primitives.js';

const PENDING_RENDER_TIME_MS = 100;
const PENDING_STATUS_TIME_MS = 200;
const COMPLETE_LOG_LINE_COUNT = 150;
const LOGS_HEIGHT = 20;
const DETAIL_DIALOG_COUNT = 1;
const LOGS_DIALOG_COUNT = 2;
const DEFAULT_RUN_HOOK_NAME = 'tool-execute-before';
const NOOP = (): void => {};

const expectNoScrollbox = (node: FakeNode): void => {
  expect(node.children.some((child) => typeof child === 'object' && child.tag === 'scrollbox')).toBe(false);
};

const openDetail = (rendered: FakeNode, dialogCalls: FakeDialogCall[]): FakeNode => {
  const hookRow = findClickableByContent(rendered, DEFAULT_RUN_HOOK_NAME);
  expect(hookRow).toBeDefined();
  hoverNode(hookRow);
  clickNode(hookRow);
  return dialogCalls.at(-1)!.render();
};

const openLogsFromDetail = (detail: FakeNode, dialogCalls: FakeDialogCall[]): FakeNode => {
  clickLabelledNode(detail, 'View logs');
  return dialogCalls.at(-1)!.render();
};

const expectDetailDialog = (node: FakeNode, expectedTexts: readonly string[]): void => {
  const detailText = collectText(node);
  for (const expectedText of expectedTexts) {
    expect(detailText).toContain(expectedText);
  }
};

const expectDetailWithoutOutput = (detail: FakeNode, hiddenTexts: readonly string[]): void => {
  expectDetailDialog(detail, [`Hook run: `, 'Status: In progress']);
  for (const hiddenText of hiddenTexts) {
    expect(collectText(detail)).not.toContain(hiddenText);
  }
  expectNoScrollbox(detail);
};

const expectLogsWithScrollbox = (logsView: FakeNode, expectedTexts: readonly string[]): void => {
  const logsText = collectText(logsView);
  for (const expectedText of expectedTexts) {
    expect(logsText).toContain(expectedText);
  }
  expect(logsView.children.some((child) => typeof child === 'object' && child.tag === 'scrollbox')).toBe(true);
};

const buildPendingStatusSnapshot = (workspaceRoot: string) => ({
  version: 1 as const,
  pid: 1,
  workspace: workspaceRoot,
  updatedAt: PENDING_STATUS_TIME_MS,
  hooks: {
    'tool.execute.before': {
      status: HookRunState.PENDING,
      startedAt: PENDING_STATUS_TIME_MS,
    },
  },
});

afterEach(() => {
  mock.restore();
  cleanupDialogWorkspaces();
});

describe('hook dialog logs navigation', () => {
  test('should open detail popup and navigate to logs when runs exist', async () => {
    const workspace = createDialogWorkspace('owflow-tui-dialogs-test-');
    writeHookFile(workspace, 'tool-execute-before.sh');
    const logFile = path.join(workspace.root, 'hook-logs.jsonl');
    const statusFile = path.join(workspace.root, 'status.json');
    writeLogRecord(logFile, makeLogRecord({ stdout: 'my log content' }));
    spyOn(Date, 'now').mockReturnValue(0);

    const { slots, dialogCalls, resolveLogFileSpy } = await registerSidebar({ workspace, statusFile, logFile });
    const rendered = renderSidebar({ slots, theme: THEME });
    const detail = openDetail(rendered, dialogCalls);
    expect(dialogCalls).toHaveLength(DETAIL_DIALOG_COUNT);
    expect(resolveLogFileSpy).toHaveBeenCalledWith(workspace.root, DEFAULT_RUN_HOOK_NAME);
    expectDetailDialog(detail, [`Hook run: ${DEFAULT_RUN_HOOK_NAME}`, 'View logs']);
    expect(collectText(detail)).not.toContain('my log content');
    expectNoScrollbox(detail);

    const logsView = openLogsFromDetail(detail, dialogCalls);
    expect(dialogCalls).toHaveLength(LOGS_DIALOG_COUNT);
    expect(collectText(logsView)).toContain('my log content');

    clickLabelledNode(logsView, 'esc');
  });
});

describe('hook dialog in-progress logs', () => {
  test('should open popup without logs in first popup and view logs in second popup when hook is In progress', async () => {
    const workspace = createDialogWorkspace('owflow-tui-dialogs-test-');
    writeHookFile(workspace, 'tool-execute-before.sh');
    const statusFile = path.join(workspace.root, 'status.json');
    const logFile = path.join(workspace.root, 'empty-logs.jsonl');
    spyOn(Date, 'now').mockReturnValue(PENDING_RENDER_TIME_MS);
    const inProgressRecord = makeLogRecord({
      runId: 'tool.execute.before#1',
      event: HookEvent.ToolExecuteBefore,
      hook: path.join(workspace.hooksDirectory, 'tool-execute-before.sh'),
      name: DEFAULT_RUN_HOOK_NAME,
      status: HookRunState.PENDING,
      startedAt: PENDING_STATUS_TIME_MS,
      stdout: 'in-progress stdout line 1\nin-progress stdout line 2\n',
      stderr: 'in-progress stderr line 1\n',
    });
    writeLogRecord(logFile, inProgressRecord);
    writeStatusSnapshot(statusFile, buildPendingStatusSnapshot(workspace.root));

    const { slots, dialogCalls } = await registerSidebar({ workspace, statusFile, logFile });
    const rendered = renderSidebar({ slots, theme: THEME });
    const detail = openDetail(rendered, dialogCalls);
    expect(dialogCalls).toHaveLength(DETAIL_DIALOG_COUNT);
    expectDetailWithoutOutput(detail, ['in-progress stdout line 1', 'in-progress stderr line 1']);

    const logsView = openLogsFromDetail(detail, dialogCalls);
    expect(dialogCalls).toHaveLength(LOGS_DIALOG_COUNT);
    expectLogsWithScrollbox(logsView, ['in-progress stdout line 1', 'in-progress stderr line 1']);
  });
});

describe('buildHookLogsBody', () => {
  test('should render complete logs directly inside native scrollbox element', () => {
    const { runtime } = makeSolid();
    const lines = Array.from({ length: COMPLETE_LOG_LINE_COUNT }, (_, index) => `log line ${index + 1}`);
    const record = makeLogRecord({ stdout: lines.join('\n') });

    const body = buildHookLogsBody({
      record,
      theme: THEME,
      solid: runtime,
      onClose: NOOP,
      maxHeight: LOGS_HEIGHT,
    }) as FakeNode;
    const scrollbox = body.children.find((child): child is FakeNode => typeof child === 'object' && child.tag === 'scrollbox');
    expect(scrollbox).toBeDefined();
    expect(scrollbox!.props.height).toBe(LOGS_HEIGHT);
    expect(scrollbox!.props.focused).toBe(true);

    const text = collectText(scrollbox!);
    expect(text).toContain('log line 1');
    expect(text).toContain('log line 50');
    expect(text).toContain('log line 150');
  });
});
