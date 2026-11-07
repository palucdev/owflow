import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as hookLogs from '../../hooks/hooks-logs.js';
import { registerActiveHooksSidebar } from '../../tui.js';
import { buildHookLogsBody, buildHookRunDetailBody } from '../../tui/hooks-dialogs.js';
import { HookRunState } from '../../types/hook-types.js';
import { THEME, collectText, findClickableByContent, makeFakeApi, makeLogRecord, makeSolid, type FakeNode } from './primitives.js';

describe('TUI hook-dialogs', () => {
  let tmpDir: string;
  let hooksDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'owflow-tui-dialogs-test-'));
    hooksDir = path.join(tmpDir, '.owflow', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
  });

  afterEach(() => {
    mock.restore();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('interaction and dialogs', () => {
    test('should open detail popup and navigate to logs when runs exist', async () => {
      fs.writeFileSync(path.join(hooksDir, 'tool-execute-before.sh'), '');
      const logFile = path.join(tmpDir, 'hook-logs.jsonl');
      const record = makeLogRecord({ stdout: 'my log content' });
      fs.writeFileSync(logFile, `${JSON.stringify(record)}\n`, 'utf8');

      spyOn(hookLogs, 'resolveHooksStatusFile').mockReturnValue(path.join(tmpDir, 'status.json'));
      spyOn(hookLogs, 'resolveHooksLogFile').mockReturnValue(logFile);
      spyOn(Date, 'now').mockReturnValue(0);

      const { api, slots, dialogCalls } = makeFakeApi(tmpDir);
      const { runtime } = makeSolid();

      await registerActiveHooksSidebar(api, tmpDir, async () => runtime);

      const rendered = slots[0].slots.sidebar_content({
        theme: { current: THEME },
      });
      const hookRow = findClickableByContent(rendered, 'tool-execute-before');
      expect(hookRow).toBeDefined();

      // Click hook row opens detail dialog
      hookRow!.props.onMouseOver?.();
      hookRow!.props.onMouseOut?.();
      (hookRow!.props.onMouseUp as () => void)();
      expect(dialogCalls).toHaveLength(1);

      const detail = dialogCalls[0]!.render();
      const detailText = collectText(detail);
      expect(detailText).toContain('Hook run: tool-execute-before');
      expect(detailText).toContain('View logs');

      // Click "View logs" opens logs dialog
      const viewLogsButton = findClickableByContent(detail, 'View logs');
      expect(viewLogsButton).toBeDefined();
      viewLogsButton!.props.onMouseOver?.();
      viewLogsButton!.props.onMouseOut?.();
      (viewLogsButton!.props.onMouseUp as () => void)();

      expect(dialogCalls).toHaveLength(2);
      const logsView = dialogCalls[1]!.render();
      expect(collectText(logsView)).toContain('my log content');

      // Close dialog via esc button
      const escButton = findClickableByContent(logsView, 'esc');
      escButton?.props.onMouseUp?.();
    });

    test('should show toast when clicked hook has no recorded runs', async () => {
      fs.writeFileSync(path.join(hooksDir, 'tool-execute-before.sh'), '');
      const { api, slots, dialogCalls, toasts } = makeFakeApi(tmpDir);
      const { runtime } = makeSolid();

      spyOn(hookLogs, 'resolveHooksStatusFile').mockReturnValue(path.join(tmpDir, 'status.json'));
      spyOn(hookLogs, 'resolveHooksLogFile').mockReturnValue(path.join(tmpDir, 'empty-logs.jsonl'));

      await registerActiveHooksSidebar(api, tmpDir, async () => runtime);

      const rendered = slots[0].slots.sidebar_content({
        theme: { current: THEME },
      });
      const hookRow = findClickableByContent(rendered, 'tool-execute-before');
      (hookRow!.props.onMouseUp as () => void)();

      expect(dialogCalls).toHaveLength(0);
      expect(toasts).toHaveLength(1);
      expect(toasts[0].message).toContain('No runs recorded for tool-execute-before');
    });

    test('should open popup and view logs when hook is In progress', async () => {
      fs.writeFileSync(path.join(hooksDir, 'tool-execute-before.sh'), '');
      const statusFile = path.join(tmpDir, 'status.json');
      const logFile = path.join(tmpDir, 'empty-logs.jsonl');
      const now = Date.now();
      fs.writeFileSync(
        statusFile,
        JSON.stringify({
          version: 1,
          pid: 1,
          workspace: tmpDir,
          updatedAt: now,
          hooks: {
            'tool.execute.before': {
              status: 'pending',
              startedAt: now,
              stdout: 'in-progress stdout line 1\nin-progress stdout line 2',
              stderr: 'in-progress stderr line 1',
            },
          },
        }),
        'utf8',
      );

      spyOn(hookLogs, 'resolveHooksStatusFile').mockReturnValue(statusFile);
      spyOn(hookLogs, 'resolveHooksLogFile').mockReturnValue(logFile);

      const { api, slots, dialogCalls, toasts } = makeFakeApi(tmpDir);
      const { runtime } = makeSolid();

      await registerActiveHooksSidebar(api, tmpDir, async () => runtime);

      const rendered = slots[0].slots.sidebar_content({
        theme: { current: THEME },
      });
      const hookRow = findClickableByContent(rendered, 'tool-execute-before');
      expect(hookRow).toBeDefined();

      (hookRow!.props.onMouseUp as () => void)();
      expect(toasts).toHaveLength(0);
      expect(dialogCalls).toHaveLength(1);

      const detail = dialogCalls[0]!.render() as FakeNode;
      const detailText = collectText(detail);
      expect(detailText).toContain('Hook run: tool-execute-before');
      expect(detailText).toContain('Status: In progress');
      expect(detail.children.some((c) => typeof c === 'object' && c.tag === 'scrollbox')).toBe(true);

      const viewLogsButton = findClickableByContent(detail, 'View logs');
      expect(viewLogsButton).toBeDefined();
      (viewLogsButton!.props.onMouseUp as () => void)();

      expect(dialogCalls).toHaveLength(2);
      const logsView = dialogCalls[1]!.render() as FakeNode;
      const logsText = collectText(logsView);
      expect(logsText).toContain('in-progress stdout line 1');
      expect(logsText).toContain('in-progress stderr line 1');
      expect(logsView.children.some((c) => typeof c === 'object' && c.tag === 'scrollbox')).toBe(true);
    });
  });

  describe('buildHookLogsBody and buildHookRunDetailBody scrolling', () => {
    test('should make logs scrollable for Error and In progress states in both detail and logs popups', () => {
      const { runtime } = makeSolid();
      const lines = Array.from({ length: 80 }, (_, i) => `output line ${i + 1}`).join('\n');

      for (const status of [HookRunState.FAILURE, HookRunState.PENDING]) {
        const record = makeLogRecord({
          status,
          reason: lines,
          stderr: lines,
        });

        const detailBody = buildHookRunDetailBody(
          record,
          '/tmp/logs.jsonl',
          THEME,
          runtime,
          () => {},
          () => {},
          1,
          12,
          undefined,
          30,
        ) as FakeNode;
        const detailScrollbox = detailBody.children.find((c): c is FakeNode => typeof c === 'object' && c.tag === 'scrollbox');
        expect(detailScrollbox).toBeDefined();
        expect(collectText(detailScrollbox!)).toContain('output line 1');
        detailScrollbox!.props.onScroll();
        expect(collectText(detailScrollbox!)).toContain('output line 50');

        const logsBody = buildHookLogsBody(record, THEME, runtime, () => {}, 20, undefined, 30) as FakeNode;
        const logsScrollbox = logsBody.children.find((c): c is FakeNode => typeof c === 'object' && c.tag === 'scrollbox');
        expect(logsScrollbox).toBeDefined();
        expect(collectText(logsScrollbox!)).toContain('output line 1');
        logsScrollbox!.props.onScroll();
        expect(collectText(logsScrollbox!)).toContain('output line 50');
      }
    });
    test('should lazy-load large logs in chunks on scroll', () => {
      const { runtime } = makeSolid();
      const lines = Array.from({ length: 150 }, (_, i) => `log line ${i + 1}`);
      const record = makeLogRecord({ stdout: lines.join('\n') });
      let rendered = false;

      const body = buildHookLogsBody(
        record,
        THEME,
        runtime,
        () => {},
        20,
        {
          requestRender: () => {
            rendered = true;
          },
        },
        50,
      ) as FakeNode;

      const scrollbox = body.children.find((c): c is FakeNode => typeof c === 'object' && c.tag === 'scrollbox');
      expect(scrollbox).toBeDefined();

      // Initial chunk (50 lines loaded)
      let text = collectText(scrollbox!);
      expect(text).toContain('log line 1');
      expect(text).toContain('log line 49');
      expect(text).not.toContain('log line 50');
      expect(text).toContain('[scroll for more logs: 50/151 lines loaded]');

      // Scroll to trigger loadMore
      expect(typeof scrollbox!.props.onScroll).toBe('function');
      scrollbox!.props.onScroll();

      // 100 lines loaded
      text = collectText(scrollbox!);
      expect(text).toContain('log line 50');
      expect(text).toContain('log line 99');
      expect(rendered).toBe(true);

      // Load all
      scrollbox!.props.loadAll();
      text = collectText(scrollbox!);
      expect(text).toContain('log line 150');
      expect(text).not.toContain('[scroll for more logs');
    });
  });
});
