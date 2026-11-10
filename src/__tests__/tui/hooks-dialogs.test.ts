import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import type { TimerHandler } from 'bun';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as hookLogs from '../../hooks/hooks-persistence.js';
import { registerActiveHooksSidebar } from '../../tui.js';
import { buildHookLogsBody, buildHookRunDetailBody, getActiveDialogHandle } from '../../tui/hooks-dialogs.js';
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

      const detail = dialogCalls[0]!.render() as FakeNode;
      const detailText = collectText(detail);
      expect(detailText).toContain('Hook run: tool-execute-before');
      expect(detailText).toContain('View logs');
      expect(detailText).not.toContain('my log content');
      expect(detail.children.some((c) => typeof c === 'object' && c.tag === 'scrollbox')).toBe(false);

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

    test('should open identical detail popup and navigate to logs when clicked hook is Idle (no recorded runs)', async () => {
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

      expect(toasts).toHaveLength(0);
      expect(dialogCalls).toHaveLength(1);

      const detail = dialogCalls[0]!.render() as FakeNode;
      const detailText = collectText(detail);
      expect(detailText).toContain('Hook run: tool-execute-before');
      expect(detailText).toContain('Status: Idle — 0 ms');
      expect(detailText).toContain('Runs in session: 0');
      expect(detailText).toContain('View logs');
      expect(detail.children.some((c) => typeof c === 'object' && c.tag === 'scrollbox')).toBe(false);

      const viewLogsButton = findClickableByContent(detail, 'View logs');
      expect(viewLogsButton).toBeDefined();
      (viewLogsButton!.props.onMouseUp as () => void)();

      expect(dialogCalls).toHaveLength(2);
      const logsView = dialogCalls[1]!.render() as FakeNode;
      expect(collectText(logsView)).toContain('No output captured for this run.');
    });

    test('should open popup without logs in first popup and view logs in second popup when hook is In progress', async () => {
      fs.writeFileSync(path.join(hooksDir, 'tool-execute-before.sh'), '');
      const statusFile = path.join(tmpDir, 'status.json');
      const logFile = path.join(tmpDir, 'empty-logs.jsonl');
      const now = Date.now();
      const streamFiles = hookLogs.resolveHookStreamLogFiles(logFile, 'tool-execute-before');
      fs.writeFileSync(streamFiles.stdout, 'in-progress stdout line 1\nin-progress stdout line 2\n', 'utf8');
      fs.writeFileSync(streamFiles.stderr, 'in-progress stderr line 1\n', 'utf8');
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
      expect(detailText).not.toContain('in-progress stdout line 1');
      expect(detailText).not.toContain('in-progress stderr line 1');
      expect(detail.children.some((c) => typeof c === 'object' && c.tag === 'scrollbox')).toBe(false);

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

    test('should only invoke solid.createElement inside dialog.replace render callback when RendererContext is active', async () => {
      fs.writeFileSync(path.join(hooksDir, 'session-idle.sh'), '');
      const statusFile = path.join(tmpDir, 'status.json');
      const logFile = path.join(tmpDir, 'hook-logs.jsonl');
      const now = Date.now();
      fs.writeFileSync(
        statusFile,
        JSON.stringify({
          version: 1,
          pid: 1,
          workspace: tmpDir,
          updatedAt: now,
          hooks: {
            'session.idle': {
              status: 'failure',
              startedAt: now - 100,
              finishedAt: now,
              durationMs: 100,
              reason: 'build failed',
            },
          },
        }),
        'utf8',
      );

      spyOn(hookLogs, 'resolveHooksStatusFile').mockReturnValue(statusFile);
      spyOn(hookLogs, 'resolveHooksLogFile').mockReturnValue(logFile);

      const { api, slots, dialogCalls } = makeFakeApi(tmpDir);
      const { runtime: baseRuntime } = makeSolid();
      let inRenderContext = false;
      const contextGuardedRuntime = {
        ...baseRuntime,
        createElement: (tag: string) => {
          if (!inRenderContext) {
            throw new Error('No renderer found');
          }
          return baseRuntime.createElement(tag);
        },
      };

      await registerActiveHooksSidebar(api, tmpDir, async () => contextGuardedRuntime);

      inRenderContext = true;
      const rendered = slots[0].slots.sidebar_content({
        theme: { current: THEME },
      });
      inRenderContext = false;

      const hookRow = findClickableByContent(rendered, 'session-idle');
      expect(hookRow).toBeDefined();

      // Clicking outside Solid render context must still register the dialog without throwing "No renderer found"
      (hookRow!.props.onMouseUp as () => void)();
      expect(dialogCalls).toHaveLength(1);

      inRenderContext = true;
      const detail = dialogCalls[0]!.render() as FakeNode;
      inRenderContext = false;
      expect(collectText(detail)).toContain('Status: Error — 100 ms');

      // Clicking "View logs" outside Solid render context must also register the logs dialog
      const viewLogsButton = findClickableByContent(detail, 'View logs')!;
      (viewLogsButton.props.onMouseUp as () => void)();
      expect(dialogCalls).toHaveLength(2);

      inRenderContext = true;
      const logsView = dialogCalls[1]!.render() as FakeNode;
      inRenderContext = false;
      expect(collectText(logsView)).toContain('build failed');
    });
  });

  describe('buildHookLogsBody and buildHookRunDetailBody styling and scrolling', () => {
    test('should render identical centered structure without logs in detail popup for Idle, In progress, and Error, and scroll logs in logs popup', () => {
      const { runtime } = makeSolid();
      const lines = Array.from({ length: 80 }, (_, i) => `output line ${i + 1}`).join('\n');

      const states = [HookRunState.IDLE, HookRunState.PENDING, HookRunState.FAILURE] as const;
      const structures: string[][] = [];

      for (const status of states) {
        const record = makeLogRecord({
          status,
          startedAt: status === HookRunState.IDLE ? 0 : 1_000,
          finishedAt: status === HookRunState.IDLE ? 0 : 1_123,
          durationMs: status === HookRunState.IDLE ? 0 : 123,
          reason: status === HookRunState.FAILURE ? lines : undefined,
          stderr: status === HookRunState.IDLE ? undefined : lines,
        });

        const detailBody = buildHookRunDetailBody(
          record,
          '/tmp/logs.jsonl',
          THEME,
          runtime,
          () => {},
          () => {},
          status === HookRunState.IDLE ? 0 : 1,
        ) as FakeNode;

        expect(detailBody.props.alignItems).toBe('center');
        expect(detailBody.props.justifyContent).toBe('center');
        expect(detailBody.children.some((c) => typeof c === 'object' && c.tag === 'scrollbox')).toBe(false);

        const detailText = collectText(detailBody);
        expect(detailText).not.toContain('output line 1');
        expect(detailText).toContain('View logs');
        structures.push(detailBody.children.map((c) => (typeof c === 'string' ? 'string' : c.tag)));

        if (status !== HookRunState.IDLE) {
          const logsBody = buildHookLogsBody(record, THEME, runtime, () => {}, 20, undefined, 30) as FakeNode;
          expect(logsBody.props.alignItems).toBe('center');
          expect(logsBody.props.justifyContent).toBe('center');
          const logsScrollbox = logsBody.children.find((c): c is FakeNode => typeof c === 'object' && c.tag === 'scrollbox');
          expect(logsScrollbox).toBeDefined();
          expect(collectText(logsScrollbox!)).toContain('output line 1');
          logsScrollbox!.props.onScroll();
          expect(collectText(logsScrollbox!)).toContain('output line 50');
        }
      }

      expect(structures[0]).toEqual(structures[1]);
      expect(structures[1]).toEqual(structures[2]);
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

    test('should preserve scroll position when not at bottom and tail-follow when at bottom on updateRecord', () => {
      const { runtime } = makeSolid();
      const initialLines = Array.from({ length: 80 }, (_, i) => `line ${i + 1}`);
      const record = makeLogRecord({ status: HookRunState.PENDING, stdout: initialLines.join('\n') });

      const body = buildHookLogsBody(record, THEME, runtime, () => {}, 20, undefined, 50) as FakeNode;
      const scrollbox = body.children.find((c): c is FakeNode => typeof c === 'object' && c.tag === 'scrollbox')!;

      // User has not scrolled to bottom (50/81 lines loaded) -> updateRecord should not hijack scroll position
      const moreLines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
      body.props.updateRecord(makeLogRecord({ status: HookRunState.PENDING, stdout: moreLines.join('\n') }));
      let text = collectText(scrollbox);
      expect(text).toContain('line 49');
      expect(text).not.toContain('line 50');
      expect(text).toContain('[scroll for more logs: 50/101 lines loaded]');

      // Scroll to bottom (loadAll) -> subsequent updateRecord should tail-follow automatically
      scrollbox.props.loadAll();
      expect(collectText(scrollbox)).toContain('line 100');

      const tailLines = Array.from({ length: 110 }, (_, i) => `line ${i + 1}`);
      body.props.updateRecord(makeLogRecord({ status: HookRunState.PENDING, stdout: tailLines.join('\n') }));
      text = collectText(scrollbox);
      expect(text).toContain('line 110');
      expect(text).not.toContain('[scroll for more logs');
    });
  });

  describe('live polling updates and lifecycle', () => {
    test('should update detail popup in-place without calling dialog.replace when status transitions from pending to success', async () => {
      fs.writeFileSync(path.join(hooksDir, 'tool-execute-before.sh'), '');
      const statusFile = path.join(tmpDir, 'status.json');
      const logFile = path.join(tmpDir, 'hook-logs.jsonl');
      const startedAt = 1_000;

      fs.writeFileSync(
        statusFile,
        JSON.stringify({
          version: 1,
          pid: 1,
          workspace: tmpDir,
          updatedAt: startedAt,
          hooks: {
            'tool.execute.before': {
              status: HookRunState.PENDING,
              startedAt,
            },
          },
        }),
        'utf8',
      );

      let tickFn: (() => void) | undefined;
      spyOn(hookLogs, 'resolveHooksStatusFile').mockReturnValue(statusFile);
      spyOn(hookLogs, 'resolveHooksLogFile').mockReturnValue(logFile);
      spyOn(globalThis, 'setInterval').mockImplementation(((fn: TimerHandler) => {
        tickFn = fn as () => void;
        return 1 as unknown as ReturnType<typeof setInterval>;
      }) as typeof setInterval);

      const { api, slots, dialogCalls } = makeFakeApi(tmpDir);
      const { runtime } = makeSolid();

      await registerActiveHooksSidebar(api, tmpDir, async () => runtime);

      const rendered = slots[0].slots.sidebar_content({ theme: { current: THEME } });
      const hookRow = findClickableByContent(rendered, 'tool-execute-before')!;
      (hookRow.props.onMouseUp as () => void)();

      expect(dialogCalls).toHaveLength(1);
      const detail = dialogCalls[0]!.render() as FakeNode;
      expect(collectText(detail)).toContain('Status: In progress');

      // Emit updated status to statusFile (transition to SUCCESS with exitCode 0)
      fs.writeFileSync(
        statusFile,
        JSON.stringify({
          version: 1,
          pid: 1,
          workspace: tmpDir,
          updatedAt: startedAt + 250,
          hooks: {
            'tool.execute.before': {
              status: HookRunState.SUCCESS,
              startedAt,
              finishedAt: startedAt + 250,
              durationMs: 250,
              exitCode: 0,
            },
          },
        }),
        'utf8',
      );

      tickFn!();

      // Updated in-place without triggering another dialog.replace
      expect(dialogCalls).toHaveLength(1);
      const updatedText = collectText(detail);
      expect(updatedText).toContain('Status: Success — 250 ms');
      expect(updatedText).toContain('Exit:   0');
      expect(updatedText).toContain('Runs in session: 1');
    });

    test('should stream live stdout chunks and transition to completion in logs popup, then teardown on close', async () => {
      fs.writeFileSync(path.join(hooksDir, 'tool-execute-before.sh'), '');
      const statusFile = path.join(tmpDir, 'status.json');
      const logFile = path.join(tmpDir, 'hook-logs.jsonl');
      const startedAt = 2_000;

      // Prior completed run in session so logs popup shows multi-run headers and summaries
      const firstRecord = makeLogRecord({
        runId: 'tool.execute.before#1',
        startedAt: 1_000,
        finishedAt: 1_100,
        durationMs: 100,
        status: HookRunState.SUCCESS,
        exitCode: 0,
        stdout: 'first run output',
      });
      fs.writeFileSync(logFile, `${JSON.stringify(firstRecord)}\n`, 'utf8');

      fs.writeFileSync(
        statusFile,
        JSON.stringify({
          version: 1,
          pid: 1,
          workspace: tmpDir,
          updatedAt: startedAt,
          hooks: {
            'tool.execute.before': {
              status: HookRunState.PENDING,
              startedAt,
              stdout: 'chunk 1',
            },
          },
        }),
        'utf8',
      );

      const streamFiles = hookLogs.resolveHookStreamLogFiles(logFile, 'tool-execute-before');
      fs.writeFileSync(streamFiles.stdout, 'first run output\nchunk 1\n', 'utf8');

      let tickFn: (() => void) | undefined;
      spyOn(hookLogs, 'resolveHooksStatusFile').mockReturnValue(statusFile);
      spyOn(hookLogs, 'resolveHooksLogFile').mockReturnValue(logFile);
      spyOn(Date, 'now').mockReturnValue(500);
      spyOn(globalThis, 'setInterval').mockImplementation(((fn: TimerHandler) => {
        tickFn = fn as () => void;
        return 1 as unknown as ReturnType<typeof setInterval>;
      }) as typeof setInterval);

      const { api, slots, dialogCalls } = makeFakeApi(tmpDir);
      const { runtime } = makeSolid();

      await registerActiveHooksSidebar(api, tmpDir, async () => runtime);

      const rendered = slots[0].slots.sidebar_content({ theme: { current: THEME } });
      const hookRow = findClickableByContent(rendered, 'tool-execute-before')!;
      (hookRow.props.onMouseUp as () => void)();

      const detail = dialogCalls[0]!.render() as FakeNode;
      const viewLogsButton = findClickableByContent(detail, 'View logs')!;
      (viewLogsButton.props.onMouseUp as () => void)();

      expect(dialogCalls).toHaveLength(2);
      const logsView = dialogCalls[1]!.render() as FakeNode;
      expect(collectText(logsView)).toContain('first run output\nchunk 1');
      expect(collectText(logsView)).not.toContain('chunk 2');

      // 2. Live Logs Streaming: append new stdout chunk to tracking log file
      fs.appendFileSync(streamFiles.stdout, 'chunk 2\n', 'utf8');

      tickFn!();
      expect(dialogCalls).toHaveLength(2);
      expect(collectText(logsView)).toContain('first run output\nchunk 1\nchunk 2');

      // 3. Completion Transition: append final chunk and completed record
      fs.appendFileSync(streamFiles.stdout, 'final output complete\n', 'utf8');
      const completedRecord = makeLogRecord({
        runId: 'tool.execute.before#2',
        startedAt,
        finishedAt: startedAt + 180,
        durationMs: 180,
        status: HookRunState.SUCCESS,
        exitCode: 0,
        stdout: 'chunk 1\nchunk 2\nfinal output complete',
      });
      fs.appendFileSync(logFile, `${JSON.stringify(completedRecord)}\n`, 'utf8');
      fs.writeFileSync(
        statusFile,
        JSON.stringify({
          version: 1,
          pid: 1,
          workspace: tmpDir,
          updatedAt: startedAt + 180,
          hooks: {
            'tool.execute.before': {
              status: HookRunState.SUCCESS,
              startedAt,
              finishedAt: startedAt + 180,
              durationMs: 180,
            },
          },
        }),
        'utf8',
      );

      tickFn!();
      const completedLogsText = collectText(logsView);
      expect(completedLogsText).toContain('first run output\nchunk 1\nchunk 2\nfinal output complete');

      // 4. Dialog Teardown on Close: click esc button and verify handle is cleaned up
      expect(getActiveDialogHandle()).toBeDefined();
      const escButton = findClickableByContent(logsView, 'esc')!;
      (escButton.props.onMouseUp as () => void)();
      expect(getActiveDialogHandle()).toBeUndefined();

      // Subsequent updates must not mutate the closed dialog
      fs.writeFileSync(
        statusFile,
        JSON.stringify({
          version: 1,
          pid: 1,
          workspace: tmpDir,
          updatedAt: startedAt + 500,
          hooks: {
            'tool.execute.before': {
              status: HookRunState.PENDING,
              startedAt: startedAt + 500,
              stdout: 'after-close chunk',
            },
          },
        }),
        'utf8',
      );
      tickFn!();
      expect(collectText(logsView)).not.toContain('after-close chunk');
    });
  });
});
