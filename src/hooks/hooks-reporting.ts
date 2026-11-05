import type { HookReportInput, HookReportRow, InterpreterResolution } from '../types/hook-types.js';

export const EFFECTIVE_AFTER_RESTART = 'effective after next restart';
export const TABLE_COLUMNS = ['path', 'event', 'interpreter', 'status'] as const;

export const interpreterLabel = (i: InterpreterResolution): string => `${i.resolved ?? i.expected} (${i.available ? 'available' : 'missing'})`;

export const buildReportRows = (input: HookReportInput): readonly HookReportRow[] => [
  ...(input.bypassed ? [{ path: '(all hooks)', event: '-', interpreter: '-', status: 'hooks bypassed (OWFLOW_HOOKS_DISABLED=1)' }] : []),
  ...input.entries.map((e) => ({
    path: e.path,
    event: e.event,
    interpreter: interpreterLabel(e.interpreter),
    status: e.status === 'registered' ? 'registered' : 'will fail closed at fire',
  })),
  ...(input.failures ?? []).map((f) => ({
    path: f.path,
    event: '-',
    interpreter: '-',
    status: `invalid: ${f.error}`,
  })),
];

export const renderTable = (input: HookReportInput): string => {
  const grid = [[...TABLE_COLUMNS], ...buildReportRows(input).map((r) => [r.path, r.event, r.interpreter, r.status])];
  const widths = TABLE_COLUMNS.map((_, i) => Math.max(...grid.map((row) => row[i]!.length)));
  const lines = grid.map((row) =>
    row
      .map((c, i) => c.padEnd(widths[i]!))
      .join('  ')
      .trimEnd(),
  );
  return [...lines, '', EFFECTIVE_AFTER_RESTART].join('\n');
};

export const renderSnapshot = (input: HookReportInput): readonly string[] => {
  const invalid = input.failures?.length ?? 0;
  const head = `[owflow] hooks: ${input.entries.length} loaded${invalid > 0 ? `, ${invalid} invalid` : ''}`;
  return [head, ...buildReportRows(input).map((r) => `[owflow]   ${r.path} -> ${r.event} ${r.interpreter} - ${r.status}`)];
};

export const renderJson = (input: HookReportInput): string =>
  JSON.stringify({ label: EFFECTIVE_AFTER_RESTART, bypassed: input.bypassed === true, rows: buildReportRows(input) }, null, 2);
