import { describe, expect, test } from 'bun:test';
import {
  buildReportRows,
  EFFECTIVE_AFTER_RESTART,
  interpreterLabel,
  renderJson,
  renderSnapshot,
  renderTable,
  TABLE_COLUMNS,
} from '../../hooks/hooks-reporting.js';
import { HookEvent } from '../../types/hook-types.js';

describe('hooks-reporting (table, snapshot, and json rendering)', () => {
  test('interpreterLabel formats interpreter status and resolution', () => {
    expect(interpreterLabel({ expected: 'bash', resolved: '/bin/bash', available: true })).toBe('/bin/bash (available)');
    expect(interpreterLabel({ expected: 'bash', available: true })).toBe('bash (available)');
    expect(interpreterLabel({ expected: 'pwsh', available: false })).toBe('pwsh (missing)');
  });

  test('renderTable, renderSnapshot, and renderJson format rows consistently', () => {
    const input = {
      entries: [
        {
          path: '/p/config.sh',
          event: HookEvent.Config,
          interpreter: { expected: 'bash', resolved: '/bin/bash', available: true },
          status: 'registered' as const,
        },
        {
          path: '/p/dispose.ps1',
          event: HookEvent.Dispose,
          interpreter: { expected: 'pwsh', available: false },
          status: 'will-fail-closed' as const,
        },
      ],
      failures: [{ path: '/p/bad.ts', error: 'not routable' }],
    };

    const rows = buildReportRows(input);
    expect(rows).toHaveLength(3);
    const table = renderTable(input);
    for (const col of TABLE_COLUMNS) expect(table).toContain(col);
    expect(table).toContain(EFFECTIVE_AFTER_RESTART);

    const snapWithFailures = renderSnapshot(input);
    expect(snapWithFailures[0]).toBe('[owflow] hooks: 2 loaded, 1 invalid');

    const snapNoFailures = renderSnapshot({ entries: input.entries });
    expect(snapNoFailures[0]).toBe('[owflow] hooks: 2 loaded');

    const json = JSON.parse(renderJson({ entries: [], bypassed: true }));
    expect(json.bypassed).toBe(true);
    expect(json.rows[0].status).toContain('OWFLOW_HOOKS_DISABLED=1');
  });
});
