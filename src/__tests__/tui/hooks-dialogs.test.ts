import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import * as hookLogs from '../../hooks/hooks-persistence.js';
import { registerActiveHooksSidebar } from '../../tui.js';
import { getActiveDialogHandle } from '../../tui/hooks-dialogs.js';
import type { SolidRuntime } from '../../tui/primitives.js';
import { HookRunState, type HookRunLogRecord } from '../../types/hook-types.js';
import {
  collectText,
  findClickableByContent,
  hasScrollbox,
  makeFakeApi,
  makeLogRecord,
  makeSolid,
  openDetailFor,
  openLogsFrom,
  renderSidebarSlot,
  writeStatusSnapshot,
  type FakeNode,
} from './primitives.js';
import { createWorkspaceHarness } from './workspace.js';

const MOCKED_NOW_MS = 100;
const PENDING_STARTED_AT_MS = 200;
const FAILURE_FLOW_MS = 100;
const MODAL_STARTED_AT_MS = 1000;
const MODAL_RUN_DURATION_MS = 250;
const EXPECTED_LOGS_DIALOG_COUNT = 2;

const workspaceHarness = createWorkspaceHarness('tui-dialogs');

const mockHookFileResolvers = (logFile: string): void => {
  spyOn(hookLogs, 'resolveHooksStatusFile').mockReturnValue(workspaceHarness.workspace().statusFile);
  spyOn(hookLogs, 'resolveHooksLogFile').mockReturnValue(logFile);
};

const writeHookLogFile = (logFile: string, record: HookRunLogRecord): void => {
  fs.writeFileSync(logFile, `${JSON.stringify(record)}\n`, 'utf8');
};

const registerSidebarWithFake = async (runtime: SolidRuntime): Promise<ReturnType<typeof makeFakeApi>> => {
  const { temporaryDirectory } = workspaceHarness.workspace();
  const fakeApi = makeFakeApi(temporaryDirectory);
  await registerActiveHooksSidebar(fakeApi.api, temporaryDirectory, async () => runtime);
  return fakeApi;
};

const registerInProgressSidebar = async (): Promise<ReturnType<typeof makeFakeApi>> => {
  const { temporaryDirectory, statusFile } = workspaceHarness.workspace();
  const logFile = path.join(temporaryDirectory, 'empty-logs.jsonl');
  spyOn(Date, 'now').mockReturnValue(MOCKED_NOW_MS);
  writeHookLogFile(
    logFile,
    makeLogRecord({
      status: HookRunState.PENDING,
      startedAt: PENDING_STARTED_AT_MS,
      stdout: 'in-progress stdout line 1\nin-progress stdout line 2\n',
      stderr: 'in-progress stderr line 1\n',
    }),
  );
  writeStatusSnapshot(statusFile, { event: 'tool.execute.before', status: 'pending', startedAt: PENDING_STARTED_AT_MS });
  mockHookFileResolvers(logFile);
  return registerSidebarWithFake(makeSolid().runtime);
};

const registerGuardedSidebar = async () => {
  const { temporaryDirectory, statusFile } = workspaceHarness.workspace();
  const now = Date.now();
  writeStatusSnapshot(statusFile, {
    event: 'session.idle',
    status: 'failure',
    startedAt: now - FAILURE_FLOW_MS,
    finishedAt: now,
    durationMs: FAILURE_FLOW_MS,
    reason: 'build failed',
  });
  mockHookFileResolvers(path.join(temporaryDirectory, 'hook-logs.jsonl'));
  const { runtime, withRenderContext } = makeContextGuardedRuntime(makeSolid().runtime);
  const { slots, dialogCalls } = await registerSidebarWithFake(runtime);
  return { slots, dialogCalls, withRenderContext };
};

const registerSuccessRunSidebar = async (): Promise<ReturnType<typeof makeFakeApi>> => {
  const { temporaryDirectory, statusFile } = workspaceHarness.workspace();
  const logFile = path.join(temporaryDirectory, 'hook-logs.jsonl');
  writeHookLogFile(
    logFile,
    makeLogRecord({
      status: HookRunState.SUCCESS,
      startedAt: MODAL_STARTED_AT_MS,
      finishedAt: MODAL_STARTED_AT_MS + MODAL_RUN_DURATION_MS,
      durationMs: MODAL_RUN_DURATION_MS,
      exitCode: 0,
      stdout: 'sample stdout output\nsecond line\n',
    }),
  );
  writeStatusSnapshot(statusFile, {
    event: 'tool.execute.before',
    status: HookRunState.SUCCESS,
    startedAt: MODAL_STARTED_AT_MS,
    finishedAt: MODAL_STARTED_AT_MS + MODAL_RUN_DURATION_MS,
    durationMs: MODAL_RUN_DURATION_MS,
    exitCode: 0,
  });
  spyOn(Date, 'now').mockReturnValue(0);
  mockHookFileResolvers(logFile);
  return registerSidebarWithFake(makeSolid().runtime);
};

const makeContextGuardedRuntime = (
  baseRuntime: SolidRuntime,
): { readonly runtime: SolidRuntime; readonly withRenderContext: <T>(action: () => T) => T } => {
  let isInRenderContext = false;
  const runtime: SolidRuntime = {
    ...baseRuntime,
    createElement: (tag: string): unknown => {
      if (!isInRenderContext) {
        throw new Error('No renderer found');
      }
      return baseRuntime.createElement(tag);
    },
  };
  const withRenderContext = <T>(action: () => T): T => {
    isInRenderContext = true;
    try {
      return action();
    } finally {
      isInRenderContext = false;
    }
  };
  return { runtime, withRenderContext };
};

const expectDialogTeardownOnClose = (logsView: FakeNode): void => {
  expect(getActiveDialogHandle()).toBeDefined();
  (findClickableByContent(logsView, 'esc')?.props.onMouseUp as (() => void) | undefined)?.();
  expect(getActiveDialogHandle()).toBeUndefined();
};

beforeEach(() => {
  workspaceHarness.setup();
  const { hooksDirectory } = workspaceHarness.workspace();
  fs.writeFileSync(path.join(hooksDirectory, 'tool-execute-before.sh'), '');
});
afterEach(() => {
  mock.restore();
  workspaceHarness.teardown();
});

test('should open detail popup and navigate to logs when runs exist', async () => {
  const { temporaryDirectory, statusFile } = workspaceHarness.workspace();
  const logFile = path.join(temporaryDirectory, 'hook-logs.jsonl');
  writeHookLogFile(logFile, makeLogRecord({ stdout: 'my log content' }));
  const logSpy = spyOn(hookLogs, 'resolveHooksLogFile').mockReturnValue(logFile);
  spyOn(hookLogs, 'resolveHooksStatusFile').mockReturnValue(statusFile);
  spyOn(Date, 'now').mockReturnValue(0);

  const { slots, dialogCalls } = await registerSidebarWithFake(makeSolid().runtime);
  openDetailFor(renderSidebarSlot({ slots }), 'tool-execute-before');
  expect(dialogCalls).toHaveLength(1);
  expect(logSpy).toHaveBeenCalledWith(temporaryDirectory, 'tool-execute-before');

  const detail = dialogCalls[0]!.render() as FakeNode;
  expect(collectText(detail)).toContain('Hook run: tool-execute-before');
  expect(collectText(detail)).toContain('View logs');
  expect(collectText(detail)).not.toContain('my log content');
  expect(hasScrollbox(detail)).toBe(false);

  openLogsFrom(detail);
  expect(dialogCalls).toHaveLength(EXPECTED_LOGS_DIALOG_COUNT);
  const logsView = dialogCalls[1]!.render() as FakeNode;
  expect(collectText(logsView)).toContain('my log content');
  expectDialogTeardownOnClose(logsView);
});

test('should open identical detail popup and navigate to logs when clicked hook is Idle (no recorded runs)', async () => {
  const { temporaryDirectory } = workspaceHarness.workspace();
  mockHookFileResolvers(path.join(temporaryDirectory, 'empty-logs.jsonl'));

  const { slots, dialogCalls, toasts } = await registerSidebarWithFake(makeSolid().runtime);
  openDetailFor(renderSidebarSlot({ slots }), 'tool-execute-before');
  expect(toasts).toHaveLength(0);
  expect(dialogCalls).toHaveLength(1);

  const detail = dialogCalls[0]!.render() as FakeNode;
  const detailText = collectText(detail);
  expect(detailText).toContain('Hook run: tool-execute-before');
  expect(detailText).toContain('Status: Idle — 0 ms');
  expect(detailText).toContain('Runs in session: 0');
  expect(detailText).toContain('View logs');
  expect(hasScrollbox(detail)).toBe(false);

  openLogsFrom(detail);
  expect(dialogCalls).toHaveLength(EXPECTED_LOGS_DIALOG_COUNT);
  expect(collectText(dialogCalls[1]!.render() as FakeNode)).toContain('No output captured for this run.');
});

test('should open popup without logs in first popup when hook is In progress', async () => {
  const { slots, dialogCalls, toasts } = await registerInProgressSidebar();
  openDetailFor(renderSidebarSlot({ slots }), 'tool-execute-before');
  expect(toasts).toHaveLength(0);
  expect(dialogCalls).toHaveLength(1);

  const detail = dialogCalls[0]!.render() as FakeNode;
  const detailText = collectText(detail);
  expect(detailText).toContain('Hook run: tool-execute-before');
  expect(detailText).toContain('Status: In progress');
  expect(detailText).not.toContain('in-progress stdout line 1');
  expect(detailText).not.toContain('in-progress stderr line 1');
  expect(hasScrollbox(detail)).toBe(false);
});

test('should view in-progress logs in second popup inside a scrollbox', async () => {
  const { slots, dialogCalls } = await registerInProgressSidebar();
  openDetailFor(renderSidebarSlot({ slots }), 'tool-execute-before');
  const detail = dialogCalls[0]!.render() as FakeNode;

  openLogsFrom(detail);
  expect(dialogCalls).toHaveLength(EXPECTED_LOGS_DIALOG_COUNT);
  const logsView = dialogCalls[1]!.render() as FakeNode;
  const logsText = collectText(logsView);
  expect(logsText).toContain('in-progress stdout line 1');
  expect(logsText).toContain('in-progress stderr line 1');
  expect(hasScrollbox(logsView)).toBe(true);
});

test('should open the detail dialog without a render context and render it inside one', async () => {
  const { hooksDirectory } = workspaceHarness.workspace();
  fs.writeFileSync(path.join(hooksDirectory, 'session-idle.sh'), '');
  const { slots, dialogCalls, withRenderContext } = await registerGuardedSidebar();

  const rendered = withRenderContext(() => renderSidebarSlot({ slots }));
  openDetailFor(rendered, 'session-idle');
  expect(dialogCalls).toHaveLength(1);
  const detail = withRenderContext(() => dialogCalls[0]!.render() as FakeNode);
  expect(collectText(detail)).toContain(`Status: Error — ${FAILURE_FLOW_MS} ms`);
});

test('should open the logs dialog without a render context and render it inside one', async () => {
  const { hooksDirectory } = workspaceHarness.workspace();
  fs.writeFileSync(path.join(hooksDirectory, 'session-idle.sh'), '');
  const { slots, dialogCalls, withRenderContext } = await registerGuardedSidebar();

  const rendered = withRenderContext(() => renderSidebarSlot({ slots }));
  openDetailFor(rendered, 'session-idle');
  const detail = withRenderContext(() => dialogCalls[0]!.render() as FakeNode);
  openLogsFrom(detail);
  expect(dialogCalls).toHaveLength(EXPECTED_LOGS_DIALOG_COUNT);
  const logsView = withRenderContext(() => dialogCalls[1]!.render() as FakeNode);
  expect(collectText(logsView)).toContain('build failed');
});

test('should open detail popup with latest status, navigate to logs popup, and teardown on close', async () => {
  const { slots, dialogCalls } = await registerSuccessRunSidebar();
  openDetailFor(renderSidebarSlot({ slots }), 'tool-execute-before');
  expect(dialogCalls).toHaveLength(1);

  const detail = dialogCalls[0]!.render() as FakeNode;
  const detailText = collectText(detail);
  expect(detailText).toContain('Hook run: tool-execute-before');
  expect(detailText).toContain(`Status: Success — ${MODAL_RUN_DURATION_MS} ms`);
  expect(detailText).toContain('Exit:   0');
  expect(detailText).toContain('Runs in session: 1');

  openLogsFrom(detail);
  expect(dialogCalls).toHaveLength(EXPECTED_LOGS_DIALOG_COUNT);
  const logsView = dialogCalls[1]!.render() as FakeNode;
  const logsText = collectText(logsView);
  expect(logsText).toContain('sample stdout output');
  expect(logsText).toContain('second line');
  expect(hasScrollbox(logsView)).toBe(true);

  expectDialogTeardownOnClose(logsView);
});
