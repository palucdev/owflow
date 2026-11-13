import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as hookLogs from '../../hooks/hooks-persistence.js';
import { registerActiveHooksSidebar } from '../../tui.js';
import { materializeSidebar } from '../../tui/hooks-sidebar.js';
import { buildActiveHooksView } from '../../tui/hooks-presenter.js';
import { THEME, collectText, findClickableByContent, makeFakeApi, makeSolid, wait } from './primitives.js';
import type { TimerHandler } from 'bun';

describe('TUI hooks-sidebar', () => {
  let tmpDir: string;
  let hooksDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'owflow-tui-sidebar-test-'));
    hooksDir = path.join(tmpDir, '.owflow', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
  });

  afterEach(() => {
    mock.restore();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('should register sidebar slot and render active hooks or (none) when empty', async () => {
    const { api, slots } = makeFakeApi(tmpDir);
    const { runtime } = makeSolid();

    // Empty hooks directory
    await registerActiveHooksSidebar(api, tmpDir, async () => runtime);
    expect(slots).toHaveLength(1);
    expect(slots[0].order).toBe(50);

    const emptyRender = slots[0].slots.sidebar_content({
      theme: { current: THEME },
    });
    expect(collectText(emptyRender)).toContain('(none)');

    // With hooks registered and session_id
    fs.writeFileSync(path.join(hooksDir, 'tool-execute-before.sh'), '');
    const { api: apiWithHooks, slots: slotsWithHooks } = makeFakeApi(tmpDir);
    await registerActiveHooksSidebar(apiWithHooks, tmpDir, async () => runtime);

    const hookRender = slotsWithHooks[0].slots.sidebar_content({ theme: { current: THEME } }, { session_id: 'ses-test' });
    const text = collectText(hookRender);
    expect(text).toContain('Active hooks:');
    expect(text).toContain('tool-execute-before');
    expect(text).toContain('Idle');
  });

  describe('status polling and lifecycle', () => {
    test('should update status from status file and clean up on dispose', async () => {
      fs.writeFileSync(path.join(hooksDir, 'tool-execute-before.sh'), '');
      const statusFile = path.join(tmpDir, 'status.json');
      const { api, slots, disposeCallbacks, getRenders } = makeFakeApi(tmpDir);
      const { runtime } = makeSolid();

      const realSetInterval = globalThis.setInterval;
      spyOn(hookLogs, 'resolveHooksStatusFile').mockReturnValue(statusFile);
      spyOn(globalThis, 'setInterval').mockImplementation(((fn: TimerHandler) => realSetInterval(fn, 10)) as typeof setInterval);

      await registerActiveHooksSidebar(api, tmpDir, async () => runtime);

      const rendered = slots[0].slots.sidebar_content({
        theme: { current: THEME },
      });
      expect(collectText(rendered)).toContain('Idle');

      // Update status file to pending
      const now = Date.now();
      fs.writeFileSync(
        statusFile,
        JSON.stringify({
          version: 1,
          pid: 1,
          workspace: tmpDir,
          updatedAt: now,
          hooks: {
            'tool.execute.before': { status: 'pending', startedAt: now },
          },
        }),
      );
      await wait(30);

      expect(collectText(rendered)).toContain('In progress');
      expect(getRenders()).toBeGreaterThan(0);

      // Clean up on dispose stops polling
      for (const cb of disposeCallbacks) cb();
      const rendersBefore = getRenders();

      fs.writeFileSync(
        statusFile,
        JSON.stringify({
          version: 1,
          pid: 1,
          workspace: tmpDir,
          updatedAt: Date.now(),
          hooks: {
            'tool.execute.before': {
              status: 'success',
              startedAt: now,
              finishedAt: Date.now(),
            },
          },
        }),
      );
      await wait(30);

      expect(getRenders()).toBe(rendersBefore);
    });

    test('should disable polling and interactions when OWFLOW_HOOKS_DISABLED=1', async () => {
      const prev = process.env.OWFLOW_HOOKS_DISABLED;
      process.env.OWFLOW_HOOKS_DISABLED = '1';

      try {
        fs.writeFileSync(path.join(hooksDir, 'tool-execute-before.sh'), '');
        const { api, slots } = makeFakeApi(tmpDir);
        const { runtime } = makeSolid();

        spyOn(hookLogs, 'resolveHooksStatusFile').mockReturnValue(path.join(tmpDir, 'status.json'));

        await registerActiveHooksSidebar(api, tmpDir, async () => runtime);

        const rendered = slots[0].slots.sidebar_content({
          theme: { current: THEME },
        });
        const hookRow = findClickableByContent(rendered, 'tool-execute-before');
        expect(hookRow).toBeUndefined(); // Non-interactive
      } finally {
        if (prev === undefined) delete process.env.OWFLOW_HOOKS_DISABLED;
        else process.env.OWFLOW_HOOKS_DISABLED = prev;
      }
    });

    test('should explicitly dispose handle and clean up via solid onCleanup', () => {
      fs.writeFileSync(path.join(hooksDir, 'tool-execute-before.sh'), '');
      const view = buildActiveHooksView(tmpDir);
      const { runtime, triggerCleanup } = makeSolid();

      const handle = materializeSidebar(
        view,
        THEME,
        runtime,
        () => {},
        () => {},
        true,
        0,
      );

      expect(typeof (handle as any).dispose).toBe('function');
      expect(handle.disposed()).toBe(false);

      // Trigger Solid onCleanup
      triggerCleanup();

      expect(handle.disposed()).toBe(true);
      expect(handle.applyStatuses(new Map([['tool.execute.before', { status: 'pending', startedAt: 100 }]]))).toBe(false);
    });

    test('should deregister disposed handles on slot unmount and prevent memory accumulation', async () => {
      fs.writeFileSync(path.join(hooksDir, 'tool-execute-before.sh'), '');
      const statusFile = path.join(tmpDir, 'status.json');
      const { api, slots } = makeFakeApi(tmpDir);
      const { runtime, triggerCleanup } = makeSolid();

      const realSetInterval = globalThis.setInterval;
      spyOn(hookLogs, 'resolveHooksStatusFile').mockReturnValue(statusFile);
      spyOn(globalThis, 'setInterval').mockImplementation(((fn: TimerHandler) => realSetInterval(fn, 10)) as typeof setInterval);

      await registerActiveHooksSidebar(api, tmpDir, async () => runtime);

      // Render slot instance 1
      const rendered1 = slots[0].slots.sidebar_content({ theme: { current: THEME } }, { session_id: 's1' });
      expect(collectText(rendered1)).toContain('Idle');

      // Unmount slot instance 1 via solid onCleanup
      triggerCleanup();

      // Render slot instance 2
      const rendered2 = slots[0].slots.sidebar_content({ theme: { current: THEME } }, { session_id: 's2' });
      expect(collectText(rendered2)).toContain('Idle');

      // Update status file
      const now = Date.now();
      fs.writeFileSync(
        statusFile,
        JSON.stringify({
          version: 1,
          pid: 1,
          workspace: tmpDir,
          updatedAt: now,
          hooks: {
            'tool.execute.before': { status: 'pending', startedAt: now, sessionID: 's1' },
          },
        }),
      );
      await wait(30);

      // The unmounted instance (s1) should NOT have been updated because it was disposed
      expect(collectText(rendered1)).toContain('Idle');
    });

    test('should dispose all active handles when api lifecycle onDispose fires', async () => {
      fs.writeFileSync(path.join(hooksDir, 'tool-execute-before.sh'), '');
      const { api, slots, disposeCallbacks } = makeFakeApi(tmpDir);
      const { runtime } = makeSolid();

      await registerActiveHooksSidebar(api, tmpDir, async () => runtime);

      const rendered = slots[0].slots.sidebar_content({ theme: { current: THEME } }, { session_id: 's1' });
      expect(collectText(rendered)).toContain('Idle');

      // Trigger lifecycle dispose
      for (const cb of disposeCallbacks) cb();

      // Mouse events or status updates after lifecycle dispose should be no-ops
      const rowNode = findClickableByContent(rendered, 'tool-execute-before');
      expect(rowNode).toBeDefined();
      expect(() => rowNode?.props.onMouseUp?.()).not.toThrow();
      expect(() => rowNode?.props.onMouseOver?.()).not.toThrow();
      expect(() => rowNode?.props.onMouseOut?.()).not.toThrow();
    });

    test('should ignore mouse interactions on directly disposed sidebar handle', () => {
      fs.writeFileSync(path.join(hooksDir, 'tool-execute-before.sh'), '');
      const view = buildActiveHooksView(tmpDir);
      const { runtime } = makeSolid();
      let clicked = false;
      let hovered = false;

      const handle = materializeSidebar(
        view,
        THEME,
        runtime,
        () => {
          clicked = true;
        },
        () => {
          hovered = true;
        },
        true,
        0,
      );

      const rowNode = findClickableByContent(handle.root as any, 'tool-execute-before');
      expect(rowNode).toBeDefined();

      handle.dispose();
      expect(handle.disposed()).toBe(true);

      rowNode?.props.onMouseUp?.();
      expect(clicked).toBe(false);

      rowNode?.props.onMouseOver?.();
      expect(hovered).toBe(false);

      rowNode?.props.onMouseOut?.();
      expect(hovered).toBe(false);
    });
  });
});
