import type { HookReportInput, HookReportRow, InterpreterResolution } from '../types/hook-types.js';

export const interpreterLabel = (resolution: InterpreterResolution): string =>
  `${resolution.resolved ?? resolution.expected} (${resolution.available ? 'available' : 'missing'})`;

const buildReportRows = (input: HookReportInput): readonly HookReportRow[] => [
  ...(input.bypassed ? [{ path: '(all hooks)', event: '-', interpreter: '-', status: 'hooks bypassed (OWFLOW_HOOKS_DISABLED=1)' }] : []),
  ...input.entries.map((entry) => ({
    path: entry.path,
    event: entry.event,
    interpreter: interpreterLabel(entry.interpreter),
    status: entry.status === 'registered' ? 'registered' : 'will fail closed at fire',
  })),
  ...(input.failures ?? []).map((failure) => ({
    path: failure.path,
    event: '-',
    interpreter: '-',
    status: `invalid: ${failure.error}`,
  })),
];

export const renderSnapshot = (input: HookReportInput): readonly string[] => {
  const invalid = input.failures?.length ?? 0;
  const invalidSuffix = invalid > 0 ? `, ${invalid} invalid` : '';
  const head = `[owflow] hooks: ${input.entries.length} loaded${invalidSuffix}`;
  return [head, ...buildReportRows(input).map((row) => `[owflow]   ${row.path} -> ${row.event} ${row.interpreter} - ${row.status}`)];
};
