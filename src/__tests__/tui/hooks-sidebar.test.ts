import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { HookRunState } from '../../types/hook-types.js';
import { registerActiveHooksSidebar } from '../../tui.js';
import { buildActiveHooksView } from '../../tui/hooks-presenter.js';
import { materializeSidebar } from '../../tui/hooks-sidebar.js';
import { createTestEnvironmentConfig } from '../../utils/environment-config.js';
import { THEME, collectText, findClickableByContent, makeFakeApi, makeSolid, noop, renderSidebarSlot, type FakeNode } from './primitives.js';
import { createWorkspaceHarness } from './workspace.js';

const SIDEBAR_SLOT_ORDER = 50;
const PENDING_STARTED_AT = 100;

const workspaceHarness = createWorkspaceHarness('tui-sidebar');

const writeToolExecuteBeforeHook = (): void => {
  const { hooksDirectory } = workspaceHarness.workspace();
  fs.writeFileSync(path.join(hooksDirectory, 'tool-execute-before.sh'), '');
};

beforeEach(() => {
  workspaceHarness.setup();
});

afterEach(() => {
  workspaceHarness.teardown();
});

test('should register the sidebar slot and render active hooks or (none) when empty', async () => {
  const { temporaryDirectory } = workspaceHarness.workspace();
  const { runtime } = makeSolid();

  const { api, slots } = makeFakeApi(temporaryDirectory);
  await registerActiveHooksSidebar({api, directory: temporaryDirectory, loadSolid: async () => runtime});
  expect(slots).toHaveLength(1);
  expect(slots[0]!.order).toBe(SIDEBAR_SLOT_ORDER);

  const emptyRender = renderSidebarSlot({ slots });
  expect(collectText(emptyRender)).toContain('(none)');

  writeToolExecuteBeforeHook();
  const { api: apiWithHooks, slots: slotsWithHooks } = makeFakeApi(temporaryDirectory);
  await registerActiveHooksSidebar({api: apiWithHooks, directory: temporaryDirectory, loadSolid: async () => runtime});

  const hookRender = renderSidebarSlot({ slots: slotsWithHooks, sessionID: 'ses-test' });
  const text = collectText(hookRender);
  expect(text).toContain('Active hooks:');
  expect(text).toContain('tool-execute-before');
  expect(text).toContain('Idle');
});

test('should disable polling and interactions when the config marks hooks disabled', async () => {
  writeToolExecuteBeforeHook();
  const { temporaryDirectory } = workspaceHarness.workspace();
  const { api, slots } = makeFakeApi(temporaryDirectory);
  const { runtime } = makeSolid();

  const config = createTestEnvironmentConfig({ isHooksDisabled: true });
  await registerActiveHooksSidebar({api, directory: temporaryDirectory, loadSolid: async () => runtime, config});

  const rendered = renderSidebarSlot({ slots });
  const hookRow = findClickableByContent(rendered, 'tool-execute-before');
  expect(hookRow).toBeUndefined();
});

test('should explicitly dispose the handle and clean up via solid onCleanup', () => {
  writeToolExecuteBeforeHook();
  const { temporaryDirectory } = workspaceHarness.workspace();
  const view = buildActiveHooksView(temporaryDirectory);
  const { runtime, triggerCleanup } = makeSolid();

  const handle = materializeSidebar({
    view,
    theme: THEME,
    solid: runtime,
    onRowClick: noop,
    onRowHover: noop,
    isInteractive: true,
  });

  expect(typeof handle.dispose).toBe('function');
  expect(handle.disposed()).toBe(false);

  triggerCleanup();

  expect(handle.disposed()).toBe(true);
  expect(
    handle.applyStatuses(new Map([['tool.execute.before', { status: HookRunState.PENDING, startedAt: PENDING_STARTED_AT }]])),
  ).toBe(false);
});

test('should ignore mouse interactions on a directly disposed sidebar handle', () => {
  writeToolExecuteBeforeHook();
  const { temporaryDirectory } = workspaceHarness.workspace();
  const view = buildActiveHooksView(temporaryDirectory);
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
  });

  const rowNode = findClickableByContent(handle.root as FakeNode, 'tool-execute-before');
  expect(rowNode).toBeDefined();

  handle.dispose();
  expect(handle.disposed()).toBe(true);

  (rowNode?.props.onMouseUp as (() => void) | undefined)?.();
  expect(isClicked).toBe(false);

  (rowNode?.props.onMouseOver as (() => void) | undefined)?.();
  expect(isHovered).toBe(false);

  (rowNode?.props.onMouseOut as (() => void) | undefined)?.();
  expect(isHovered).toBe(false);
});
