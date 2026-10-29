import type {
  HookRegistryEntry,
  HookReportInput,
  HookReportRow,
} from "../types/hook-types.js";
import { interpreterLabel } from "./registry.js";

export type { HookReportInput, HookReportRow };

/**
 * One row model and three pure renderers — startup snapshot (banner), table
 * (CLI default), JSON (`--json`) — shared by every visibility surface so they
 * agree by construction (R2.2/R7). Data arrives via arguments only: no
 * process/session/model reads, no I/O, no side effects.
 */

/** Standing freshness label for the would-load surfaces (A8, R7.2/R7.3). */
export const EFFECTIVE_AFTER_RESTART = "effective after next restart";

/** Header order of the table; the snapshot renders the same four cells. */
export const TABLE_COLUMNS = [
  "path",
  "event",
  "interpreter",
  "status",
] as const;

const STATUS_LABELS: Readonly<Record<HookRegistryEntry["status"], string>> = {
  registered: "registered",
  "will-fail-closed": "will fail closed at fire",
};

export const buildReportRows = (
  input: HookReportInput,
): readonly HookReportRow[] => {
  const rows: HookReportRow[] = [];
  if (input.bypassed === true) {
    rows.push({
      path: "(all hooks)",
      event: "-",
      interpreter: "-",
      status: "hooks bypassed (OWFLOW_HOOKS_DISABLED=1)",
    });
  }
  for (const entry of input.entries) {
    rows.push({
      path: entry.path,
      event: entry.event,
      interpreter: interpreterLabel(entry.interpreter),
      status: STATUS_LABELS[entry.status],
    });
  }
  for (const failure of input.failures ?? []) {
    rows.push({
      path: failure.path,
      event: "-",
      interpreter: "-",
      status: `invalid: ${failure.error}`,
    });
  }
  return rows;
};

export const renderTable = (input: HookReportInput): string => {
  const grid: string[][] = [
    [...TABLE_COLUMNS],
    ...buildReportRows(input).map((row) => [
      row.path,
      row.event,
      row.interpreter,
      row.status,
    ]),
  ];
  const widths = TABLE_COLUMNS.map((_, index) =>
    Math.max(...grid.map((cells) => cells[index]!.length)),
  );
  const lines = grid.map((cells) =>
    cells
      .map((cell, index) => cell.padEnd(widths[index]!))
      .join("  ")
      .trimEnd(),
  );
  lines.push("", EFFECTIVE_AFTER_RESTART);
  return lines.join("\n");
};

const snapshotHeading = (input: HookReportInput): string => {
  const invalid = input.failures?.length ?? 0;
  const suffix = invalid > 0 ? `, ${invalid} invalid` : "";
  return `hooks: ${input.entries.length} loaded${suffix}`;
};

export const renderSnapshot = (input: HookReportInput): readonly string[] => {
  const lines = [`[owflow] ${snapshotHeading(input)}`];
  for (const row of buildReportRows(input)) {
    lines.push(
      `[owflow]   ${row.path} -> ${row.event} ${row.interpreter} - ${row.status}`,
    );
  }
  return lines;
};

export const renderJson = (input: HookReportInput): string =>
  JSON.stringify(
    {
      label: EFFECTIVE_AFTER_RESTART,
      bypassed: input.bypassed === true,
      rows: buildReportRows(input),
    },
    null,
    2,
  );
