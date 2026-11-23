import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import type { TimerHandler } from 'bun';
import * as hookLogs from '../../hooks/hooks-persistence.js';
import { registerActiveHooksSidebar } from '../../tui.js';
import { collectText, findClickableByContent, makeFakeApi, makeSolid, renderSidebarSlot, wait, writeStatusSnapshot } from '../tui/primitives.js';
import { createWorkspaceHarness } from '../tui/workspace.js';

const POLL_INTERVAL_MS = 10;
const POLL_SETTLE_MS = 30;
const PENDING_STARTED_AT = 100;

const workspaceHarness = createWorkspaceHarness('tui-sidebar-polling');

const mockStatusPolling = (statusFile: string): void => {
  const realSetInterval = setInterval;
  spyOn(hookLogs, 'resolveHooksStatusFile').mockReturnValue(statusFile);
  spyOn(globalThis, 'setInterval').mockImplementation(((callback: TimerHandler) => realSetInterval(callback, POLL_INTERVAL_MS)) as typeof setInterval);
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

test('should update status from the status file and stop polling after dispose', async () => {
  const { temporaryDirectory, statusFile } = workspaceHarness.workspace();
  const { api, slots, disposeCallbacks, getRenders } = makeFakeApi(temporaryDirectory);
  const { runtime } = makeSolid();

  mockStatusPolling(statusFile);
  await registerActiveHooksSidebar(api, temporaryDirectory, async () => runtime);

  const rendered = renderSidebarSlot({ slots });
  expect(collectText(rendered)).toContain('Idle');

  const pendingStartedAt = Date.now();
  writeStatusSnapshot(statusFile, { event: 'tool.execute.before', status: 'pending', startedAt: pendingStartedAt });
  await wait(POLL_SETTLE_MS);

  expect(collectText(rendered)).toContain('In progress');
  expect(getRenders()).toBeGreaterThan(0);

  for (const callback of disposeCallbacks) callback();
  const rendersAfterDispose = getRenders();

  writeStatusSnapshot(statusFile, { event: 'tool.execute.before', status: 'success', startedAt: pendingStartedAt });
  await wait(POLL_SETTLE_MS);

  expect(getRenders()).toBe(rendersAfterDispose);
});

test('should deregister disposed handles on slot unmount and prevent memory accumulation', async () => {
  const { temporaryDirectory, statusFile } = workspaceHarness.workspace();
  const { api, slots } = makeFakeApi(temporaryDirectory);
  const { runtime, triggerCleanup } = makeSolid();

  mockStatusPolling(statusFile);
  await registerActiveHooksSidebar(api, temporaryDirectory, async () => runtime);

  const rendered1 = renderSidebarSlot({ slots, sessionID: 's1' });
  expect(collectText(rendered1)).toContain('Idle');

  triggerCleanup();

  const rendered2 = renderSidebarSlot({ slots, sessionID: 's2' });
  expect(collectText(rendered2)).toContain('Idle');

  writeStatusSnapshot(statusFile, { event: 'tool.execute.before', status: 'pending', startedAt: PENDING_STARTED_AT, sessionID: 's1' });
  await wait(POLL_SETTLE_MS);

  expect(collectText(rendered1)).toContain('Idle');
});

test('should dispose all active handles when the api lifecycle onDispose fires', async () => {
  const { temporaryDirectory } = workspaceHarness.workspace();
  const { api, slots, disposeCallbacks } = makeFakeApi(temporaryDirectory);
  const { runtime } = makeSolid();

  await registerActiveHooksSidebar(api, temporaryDirectory, async () => runtime);

  const rendered = renderSidebarSlot({ slots, sessionID: 's1' });
  expect(collectText(rendered)).toContain('Idle');

  for (const callback of disposeCallbacks) callback();

  const rowNode = findClickableByContent(rendered, 'tool-execute-before');
  expect(rowNode).toBeDefined();
  expect(() => (rowNode?.props.onMouseUp as (() => void) | undefined)?.()).not.toThrow();
  expect(() => (rowNode?.props.onMouseOver as (() => void) | undefined)?.()).not.toThrow();
  expect(() => (rowNode?.props.onMouseOut as (() => void) | undefined)?.()).not.toThrow();
});
