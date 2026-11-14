import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import path from 'node:path';
import * as hookLogs from '../../hooks/hooks-persistence.js';
import { registerActiveHooksSidebar } from '../../tui.js';
import { materializeSidebar } from '../../tui/hooks-sidebar.js';
import { buildActiveHooksView } from '../../tui/hooks-presenter.js';
import { HookRunState, type HookStatusSnapshot } from '../../types/hook-types.js';
import { createTestEnvironmentConfig } from '../../utils/environment-config.js';
import {
  cleanupDialogWorkspaces,
  createDialogWorkspace,
  registerSidebar,
  renderSidebar,
  writeHookFile,
  writeStatusSnapshot,
} from './dialogs-test-helpers.js';
import { THEME, collectText, findClickableByContent, makeFakeApi, makeSolid, wait, type FakeNode } from './primitives.js';

const SIDEBAR_ORDER = 50;
const POLL_INTERVAL_MS = 10;
const POLL_WAIT_MS = 30;
const STARTED_AT = 100;
const FIRST_RENDER_AT = 0;
const NOOP = (): void => {};

interface StatusSnapshotOptions {
  readonly workspaceRoot: string;
  readonly status: HookRunState;
  readonly sessionID?: string;
  readonly startedAt?: number;
}

const createStatusSnapshot = (options: StatusSnapshotOptions): HookStatusSnapshot => ({
  version: 1,
  pid: 1,
  workspace: options.workspaceRoot,
  updatedAt: options.startedAt ?? Date.now(),
  hooks: {
    'tool.execute.before': {
      status: options.status,
      startedAt: options.startedAt ?? Date.now(),
      ...(options.sessionID !== undefined && { sessionID: options.sessionID }),
    },
  },
});

const mockPollingInterval = (): void => {
  const realSetInterval = setInterval;
  spyOn(globalThis, 'setInterval').mockImplementation(((callback: () => void) => realSetInterval(callback, POLL_INTERVAL_MS)) as typeof setInterval);
};

afterEach(() => {
  mock.restore();
  cleanupDialogWorkspaces();
});

describe('sidebar slot registration', () => {
  test('should register sidebar slot and render active hooks or (none) when empty', async () => {
    const workspace = createDialogWorkspace('owflow-tui-sidebar-test-');
    const { api, slots } = makeFakeApi(workspace.root);
    const { runtime } = makeSolid();

    // Empty hooks directory
    await registerActiveHooksSidebar(api, workspace.root, async () => runtime);
    expect(slots).toHaveLength(1);
    expect(slots[0].order).toBe(SIDEBAR_ORDER);
    expect(collectText(renderSidebar({ slots, theme: THEME }))).toContain('(none)');

    // With hooks registered and session_id
    writeHookFile(workspace, 'tool-execute-before.sh');
    const { api: apiWithHooks, slots: slotsWithHooks } = makeFakeApi(workspace.root);
    await registerActiveHooksSidebar(apiWithHooks, workspace.root, async () => runtime);

    const hookText = collectText(renderSidebar({ slots: slotsWithHooks, theme: THEME, sessionID: 'ses-test' }));
    expect(hookText).toContain('Active hooks:');
    expect(hookText).toContain('tool-execute-before');
    expect(hookText).toContain('Idle');
  });
});

describe('sidebar status polling', () => {
  test('should update status from status file and clean up on dispose', async () => {
    const workspace = createDialogWorkspace('owflow-tui-sidebar-test-');
    writeHookFile(workspace, 'tool-execute-before.sh');
    const statusFile = path.join(workspace.root, 'status.json');
    mockPollingInterval();

    const { slots, disposeCallbacks, getRenders } = await registerSidebar({
      workspace,
      statusFile,
      logFile: path.join(workspace.root, 'logs.jsonl'),
    });
    const rendered = renderSidebar({ slots, theme: THEME });
    expect(collectText(rendered)).toContain('Idle');

    writeStatusSnapshot(statusFile, createStatusSnapshot({ workspaceRoot: workspace.root, status: HookRunState.PENDING }));
    await wait(POLL_WAIT_MS);

    expect(collectText(rendered)).toContain('In progress');
    expect(getRenders()).toBeGreaterThan(0);

    for (const callback of disposeCallbacks) callback();
    const rendersBefore = getRenders();

    writeStatusSnapshot(statusFile, createStatusSnapshot({ workspaceRoot: workspace.root, status: HookRunState.SUCCESS }));
    await wait(POLL_WAIT_MS);

    expect(getRenders()).toBe(rendersBefore);
  });
});

describe('sidebar disabled configuration', () => {
  test('should disable polling and interactions when hooks are disabled', async () => {
    const workspace = createDialogWorkspace('owflow-tui-sidebar-test-');
    writeHookFile(workspace, 'tool-execute-before.sh');

    const { slots } = await registerSidebar({
      workspace,
      statusFile: path.join(workspace.root, 'status.json'),
      logFile: path.join(workspace.root, 'logs.jsonl'),
      config: createTestEnvironmentConfig({ isHooksDisabled: true }),
    });
    const rendered = renderSidebar({ slots, theme: THEME });
    expect(findClickableByContent(rendered, 'tool-execute-before')).toBeUndefined();
  });
});

describe('sidebar handle disposal', () => {
  test('should explicitly dispose handle and clean up via solid onCleanup', () => {
    const workspace = createDialogWorkspace('owflow-tui-sidebar-test-');
    writeHookFile(workspace, 'tool-execute-before.sh');
    const view = buildActiveHooksView(workspace.root);
    const { runtime, triggerCleanup } = makeSolid();

    const handle = materializeSidebar({
      view,
      theme: THEME,
      solid: runtime,
      onRowClick: NOOP,
      onRowHover: NOOP,
      isInteractive: true,
      notBefore: FIRST_RENDER_AT,
    });

    expect(typeof handle.dispose).toBe('function');
    expect(handle.disposed()).toBe(false);

    triggerCleanup();

    expect(handle.disposed()).toBe(true);
    expect(handle.applyStatuses(new Map([['tool.execute.before', { status: HookRunState.PENDING, startedAt: STARTED_AT }]]))).toBe(false);
  });
});

describe('sidebar handle cleanup integration', () => {
  test('should deregister disposed handles on slot unmount and prevent memory accumulation', async () => {
    const workspace = createDialogWorkspace('owflow-tui-sidebar-test-');
    writeHookFile(workspace, 'tool-execute-before.sh');
    const statusFile = path.join(workspace.root, 'status.json');
    const { runtime, triggerCleanup } = makeSolid();
    mockPollingInterval();

    const { slots } = await registerSidebar({ workspace, statusFile, logFile: path.join(workspace.root, 'logs.jsonl'), runtime });

    const firstRendered = renderSidebar({ slots, theme: THEME, sessionID: 's1' });
    expect(collectText(firstRendered)).toContain('Idle');

    triggerCleanup();

    const secondRendered = renderSidebar({ slots, theme: THEME, sessionID: 's2' });
    expect(collectText(secondRendered)).toContain('Idle');

    writeStatusSnapshot(statusFile, createStatusSnapshot({ workspaceRoot: workspace.root, status: HookRunState.PENDING, sessionID: 's1' }));
    await wait(POLL_WAIT_MS);

    expect(collectText(firstRendered)).toContain('Idle');
  });
});

describe('sidebar lifecycle teardown', () => {
  test('should dispose all active handles when api lifecycle onDispose fires', async () => {
    const workspace = createDialogWorkspace('owflow-tui-sidebar-test-');
    writeHookFile(workspace, 'tool-execute-before.sh');
    const { api, slots, disposeCallbacks } = makeFakeApi(workspace.root);
    const { runtime } = makeSolid();

    spyOn(hookLogs, 'resolveHooksStatusFile').mockReturnValue(path.join(workspace.root, 'status.json'));
    await registerActiveHooksSidebar(api, workspace.root, async () => runtime);

    const rendered = renderSidebar({ slots, theme: THEME, sessionID: 's1' });
    expect(collectText(rendered)).toContain('Idle');

    for (const callback of disposeCallbacks) callback();

    const rowNode = findClickableByContent(rendered, 'tool-execute-before');
    expect(rowNode).toBeDefined();
    expect(() => rowNode?.props.onMouseUp?.()).not.toThrow();
    expect(() => rowNode?.props.onMouseOver?.()).not.toThrow();
    expect(() => rowNode?.props.onMouseOut?.()).not.toThrow();
  });

  test('should ignore mouse interactions on directly disposed sidebar handle', () => {
    const workspace = createDialogWorkspace('owflow-tui-sidebar-test-');
    writeHookFile(workspace, 'tool-execute-before.sh');
    const view = buildActiveHooksView(workspace.root);
    const { runtime } = makeSolid();
    let isClicked = false;
    let isHovered = false;

    const handle = materializeSidebar({
      view,
      theme: THEME,
      solid: runtime,
      onRowClick: () => {
        isClicked = true;
      },
      onRowHover: () => {
        isHovered = true;
      },
      isInteractive: true,
      notBefore: FIRST_RENDER_AT,
    });

    const rowNode = findClickableByContent(handle.root as FakeNode, 'tool-execute-before');
    expect(rowNode).toBeDefined();

    handle.dispose();
    expect(handle.disposed()).toBe(true);

    rowNode?.props.onMouseUp?.();
    expect(isClicked).toBe(false);

    rowNode?.props.onMouseOver?.();
    expect(isHovered).toBe(false);

    rowNode?.props.onMouseOut?.();
    expect(isHovered).toBe(false);
  });
});
