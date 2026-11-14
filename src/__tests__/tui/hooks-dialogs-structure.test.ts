import { describe, expect, test } from 'bun:test';
import { buildHookLogsBody, buildHookRunDetailBody } from '../../tui/hooks-dialogs.js';
import { HookRunState } from '../../types/hook-types.js';
import { THEME, collectText, makeLogRecord, makeSolid, type FakeNode } from './primitives.js';

const STRUCTURE_LINE_COUNT = 80;
const EXPECTED_MIDDLE_OUTPUT_LINE = 50;
const LOGS_HEIGHT = 20;
const STRUCTURE_STARTED_AT = 12_000;
const STRUCTURE_FINISHED_AT = 12_123;
const STRUCTURE_DURATION_MS = 123;
const TOTAL_RUNS_IN_SESSION = 1;
const EMPTY_RUNS_IN_SESSION = 0;
const NOOP = (): void => {};

describe('buildHookRunDetailBody structure', () => {
  test('should render identical centered structure without logs in detail popup for Idle, In progress, and Error, and scroll logs in logs popup', () => {
    const { runtime } = makeSolid();
    const lines = Array.from({ length: STRUCTURE_LINE_COUNT }, (_, index) => `output line ${index + 1}`).join('\n');
    const states = [HookRunState.IDLE, HookRunState.PENDING, HookRunState.FAILURE] as const;
    const structures: string[][] = [];

    for (const status of states) {
      const record = makeLogRecord({
        status,
        startedAt: status === HookRunState.IDLE ? 0 : STRUCTURE_STARTED_AT,
        finishedAt: status === HookRunState.IDLE ? 0 : STRUCTURE_FINISHED_AT,
        durationMs: status === HookRunState.IDLE ? 0 : STRUCTURE_DURATION_MS,
        reason: status === HookRunState.FAILURE ? lines : undefined,
        stderr: status === HookRunState.IDLE ? undefined : lines,
      });

      const detailBody = buildHookRunDetailBody({
        record,
        logFile: 'logs.jsonl',
        theme: THEME,
        solid: runtime,
        onShowLogs: NOOP,
        onClose: NOOP,
        totalRunsInSession: status === HookRunState.IDLE ? EMPTY_RUNS_IN_SESSION : TOTAL_RUNS_IN_SESSION,
      }) as FakeNode;

      expectDetailStructure(detailBody);
      structures.push(detailBody.children.map((child) => (typeof child === 'string' ? 'string' : child.tag)));

      if (status === HookRunState.IDLE) continue;
      const logsBody = buildHookLogsBody({ record, theme: THEME, solid: runtime, onClose: NOOP, maxHeight: LOGS_HEIGHT }) as FakeNode;
      expectLogsBodyStructure(logsBody);
    }

    expect(structures[0]).toEqual(structures[1]);
    expect(structures[1]).toEqual(structures[2]);
  });
});

const expectDetailStructure = (detailBody: FakeNode): void => {
  expect(detailBody.props.alignItems).toBe('center');
  expect(detailBody.props.justifyContent).toBe('center');
  expect(detailBody.children.some((child) => typeof child === 'object' && child.tag === 'scrollbox')).toBe(false);
  expect(collectText(detailBody)).not.toContain('output line 1');
  expect(collectText(detailBody)).toContain('View logs');
};

const expectLogsBodyStructure = (logsBody: FakeNode): void => {
  expect(logsBody.props.alignItems).toBe('center');
  expect(logsBody.props.justifyContent).toBe('center');
  const logsScrollbox = logsBody.children.find((child): child is FakeNode => typeof child === 'object' && child.tag === 'scrollbox');
  expect(logsScrollbox).toBeDefined();
  expect(logsScrollbox!.props.height).toBe(LOGS_HEIGHT);
  expect(logsScrollbox!.props.focused).toBe(true);
  const [bodyNode] = logsScrollbox!.children as FakeNode[];
  expect(bodyNode!.props.textAlign).toBe('left');
  expect(collectText(logsScrollbox!)).toContain('output line 1');
  expect(collectText(logsScrollbox!)).toContain(`output line ${EXPECTED_MIDDLE_OUTPUT_LINE}`);
};
