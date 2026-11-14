import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import path from 'node:path';
import { getActiveDialogHandle } from '../../tui/hooks-dialogs.js';
import { HookEvent, HookRunState, type HookStatusSnapshot } from '../../types/hook-types.js';
import {
  cleanupDialogWorkspaces,
  clickLabelledNode,
  createDialogWorkspace,
  registerSidebar,
  renderSidebar,
  writeHookFile,
  writeLogRecord,
  writeStatusSnapshot,
  type DialogWorkspace,
} from './dialogs-test-helpers.js';
import {
  THEME,
  collectText,
  findClickableByContent,
  makeLogRecord,
  makeSolid,
  type FakeDialogCall,
  type FakeNode,
  type FakeSlotRegistration,
} from './primitives.js';
import type { SolidRuntime } from '../../tui/primitives.js';

const DEFAULT_RUN_HOOK_NAME = 'tool-execute-before';
const IDLE_HOOK_NAME = 'session-idle';
const DETAIL_DIALOG_COUNT = 1;
const LOGS_DIALOG_COUNT = 2;
const RUN_DURATION_MS = 250;
const FAILURE_DURATION_MS = 100;
const RUN_STARTED_AT = 1000;
const TOTAL_RUNS_IN_SESSION = 1;

interface OpenDetailOptions {
  readonly rendered: FakeNode;
  readonly dialogCalls: FakeDialogCall[];
  readonly hookName: string;
}

const openDetail = (options: OpenDetailOptions): FakeNode => {
  const hookRow = findClickableByContent(options.rendered, options.hookName);
  expect(hookRow).toBeDefined();
  (hookRow?.props.onMouseUp as (() => void) | undefined)?.();
  return options.dialogCalls.at(-1)!.render();
};

const openLogsFromDetail = (detail: FakeNode, dialogCalls: FakeDialogCall[]): FakeNode => {
  clickLabelledNode(detail, 'View logs');
  return dialogCalls.at(-1)!.render();
};

const expectNoScrollbox = (node: FakeNode): void => {
  expect(node.children.some((child) => typeof child === 'object' && child.tag === 'scrollbox')).toBe(false);
};

interface GuardedRuntime {
  readonly runtime: SolidRuntime;
  readonly setInRenderContext: (isActive: boolean) => void;
}

const createGuardedRuntime = (): GuardedRuntime => {
  const { runtime: baseRuntime } = makeSolid();
  let isInRenderContext = false;
  const guardedRuntime: SolidRuntime = {
    ...baseRuntime,
    createElement: (tag: string) => {
      if (!isInRenderContext) {
        throw new Error('No renderer found');
      }
      return baseRuntime.createElement(tag);
    },
  };
  return {
    runtime: guardedRuntime,
    setInRenderContext: (isActive: boolean) => {
      isInRenderContext = isActive;
    },
  };
};

const renderGuardedSidebar = (slots: FakeSlotRegistration[], setInRenderContext: (isActive: boolean) => void): FakeNode => {
  setInRenderContext(true);
  const rendered = renderSidebar({ slots, theme: THEME });
  setInRenderContext(false);
  return rendered;
};

const openGuardedDetail = (options: OpenDetailOptions & { readonly setInRenderContext: (isActive: boolean) => void }): FakeNode => {
  const hookRow = findClickableByContent(options.rendered, options.hookName);
  expect(hookRow).toBeDefined();
  (hookRow?.props.onMouseUp as (() => void) | undefined)?.();
  expect(options.dialogCalls).toHaveLength(DETAIL_DIALOG_COUNT);
  options.setInRenderContext(true);
  const detail = options.dialogCalls[0]!.render();
  options.setInRenderContext(false);
  return detail;
};

const createSuccessRecord = (workspace: DialogWorkspace) =>
  makeLogRecord({
    runId: 'tool.execute.before#1',
    event: HookEvent.ToolExecuteBefore,
    hook: path.join(workspace.hooksDirectory, 'tool-execute-before.sh'),
    name: DEFAULT_RUN_HOOK_NAME,
    status: HookRunState.SUCCESS,
    startedAt: RUN_STARTED_AT,
    finishedAt: RUN_STARTED_AT + RUN_DURATION_MS,
    durationMs: RUN_DURATION_MS,
    exitCode: 0,
    stdout: 'sample stdout output\nsecond line\n',
  });

const expectLogsDialogContent = (logsView: FakeNode): void => {
  const logsText = collectText(logsView);
  expect(logsText).toContain('sample stdout output');
  expect(logsText).toContain('second line');
  expect(logsView.children.some((child) => typeof child === 'object' && child.tag === 'scrollbox')).toBe(true);
};

const createSuccessSnapshot = (workspaceRoot: string): HookStatusSnapshot => ({
  version: 1,
  pid: 1,
  workspace: workspaceRoot,
  updatedAt: RUN_STARTED_AT + RUN_DURATION_MS,
  hooks: {
    'tool.execute.before': {
      status: HookRunState.SUCCESS,
      startedAt: RUN_STARTED_AT,
      finishedAt: RUN_STARTED_AT + RUN_DURATION_MS,
      durationMs: RUN_DURATION_MS,
      exitCode: 0,
    },
  },
});

afterEach(() => {
  mock.restore();
  cleanupDialogWorkspaces();
});

describe('idle hook detail dialog', () => {
  test('should open identical detail popup and navigate to logs when clicked hook is Idle (no recorded runs)', async () => {
    const workspace = createDialogWorkspace('owflow-tui-dialogs-test-');
    writeHookFile(workspace, 'tool-execute-before.sh');
    const statusFile = path.join(workspace.root, 'status.json');
    const logFile = path.join(workspace.root, 'empty-logs.jsonl');

    const { slots, dialogCalls } = await registerSidebar({ workspace, statusFile, logFile });
    const rendered = renderSidebar({ slots, theme: THEME });
    const detail = openDetail({ rendered, dialogCalls, hookName: DEFAULT_RUN_HOOK_NAME });

    expect(dialogCalls).toHaveLength(DETAIL_DIALOG_COUNT);
    const detailText = collectText(detail);
    expect(detailText).toContain(`Hook run: ${DEFAULT_RUN_HOOK_NAME}`);
    expect(detailText).toContain('Status: Idle — 0 ms');
    expect(detailText).toContain('Runs in session: 0');
    expect(detailText).toContain('View logs');
    expectNoScrollbox(detail);

    const logsView = openLogsFromDetail(detail, dialogCalls);
    expect(dialogCalls).toHaveLength(LOGS_DIALOG_COUNT);
    expect(collectText(logsView)).toContain('No output captured for this run.');
  });
});

describe('dialog renderer context', () => {
  test('should only invoke solid.createElement inside dialog.replace render callback when RendererContext is active', async () => {
    const workspace = createDialogWorkspace('owflow-tui-dialogs-test-');
    writeHookFile(workspace, 'session-idle.sh');
    const statusFile = path.join(workspace.root, 'status.json');
    const logFile = path.join(workspace.root, 'hook-logs.jsonl');
    const now = Date.now();
    writeStatusSnapshot(statusFile, {
      version: 1,
      pid: 1,
      workspace: workspace.root,
      updatedAt: now,
      hooks: {
        'session.idle': {
          status: HookRunState.FAILURE,
          startedAt: now - FAILURE_DURATION_MS,
          finishedAt: now,
          durationMs: FAILURE_DURATION_MS,
          reason: 'build failed',
        },
      },
    });

    const { runtime, setInRenderContext } = createGuardedRuntime();
    const { slots, dialogCalls } = await registerSidebar({ workspace, statusFile, logFile, runtime });
    const rendered = renderGuardedSidebar(slots, setInRenderContext);
    const detail = openGuardedDetail({ rendered, dialogCalls, hookName: IDLE_HOOK_NAME, setInRenderContext });
    expect(collectText(detail)).toContain(`Status: Error — ${FAILURE_DURATION_MS} ms`);

    clickLabelledNode(detail, 'View logs');
    expect(dialogCalls).toHaveLength(LOGS_DIALOG_COUNT);

    setInRenderContext(true);
    const logsView = dialogCalls.at(-1)!.render();
    setInRenderContext(false);
    expect(collectText(logsView)).toContain('build failed');
  });
});

describe('modal dialog teardown', () => {
  test('should open detail popup with latest status, navigate to logs popup, and teardown on close', async () => {
    const workspace = createDialogWorkspace('owflow-tui-dialogs-test-');
    writeHookFile(workspace, 'tool-execute-before.sh');
    const statusFile = path.join(workspace.root, 'status.json');
    const logFile = path.join(workspace.root, 'hook-logs.jsonl');
    const record = createSuccessRecord(workspace);
    writeLogRecord(logFile, record);
    writeStatusSnapshot(statusFile, createSuccessSnapshot(workspace.root));
    spyOn(Date, 'now').mockReturnValue(0);

    const { slots, dialogCalls } = await registerSidebar({ workspace, statusFile, logFile });
    const rendered = renderSidebar({ slots, theme: THEME });
    const detail = openDetail({ rendered, dialogCalls, hookName: DEFAULT_RUN_HOOK_NAME });
    expectDetailDialogContent(detail);

    const logsView = openLogsFromDetail(detail, dialogCalls);
    expect(dialogCalls).toHaveLength(LOGS_DIALOG_COUNT);
    expectLogsDialogContent(logsView);

    expect(getActiveDialogHandle()).toBeDefined();
    clickLabelledNode(logsView, 'esc');
    expect(getActiveDialogHandle()).toBeUndefined();
  });
});

const expectDetailDialogContent = (detail: FakeNode): void => {
  const detailText = collectText(detail);
  expect(detailText).toContain(`Hook run: ${DEFAULT_RUN_HOOK_NAME}`);
  expect(detailText).toContain(`Status: Success — ${RUN_DURATION_MS} ms`);
  expect(detailText).toContain('Exit:   0');
  expect(detailText).toContain(`Runs in session: ${TOTAL_RUNS_IN_SESSION}`);
};
