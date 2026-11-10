import type { HookReportInput, HookReportRow, InterpreterResolution } from '../types/hook-types.js';

export const interpreterLabel = (i: InterpreterResolution): string => `${i.resolved ?? i.expected} (${i.available ? 'available' : 'missing'})`;

const buildReportRows = (input: HookReportInput): readonly HookReportRow[] => [
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

export const renderSnapshot = (input: HookReportInput): readonly string[] => {
  const invalid = input.failures?.length ?? 0;
  const head = `[owflow] hooks: ${input.entries.length} loaded${invalid > 0 ? `, ${invalid} invalid` : ''}`;
  return [head, ...buildReportRows(input).map((r) => `[owflow]   ${r.path} -> ${r.event} ${r.interpreter} - ${r.status}`)];
};
