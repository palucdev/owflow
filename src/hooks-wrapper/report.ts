import { interpreterLabel } from "./interpreters.js";
import type {
  HookRegistryEntry,
  HookValidationFailure,
} from "./types.js";

/**
 * One row model and three pure renderers — startup snapshot (banner), table
 * (CLI default), JSON (`--json`) — shared by every visibility surface so they
 * agree by construction (R2.2/R7). Data arrives via arguments only: no
 * process/session/model reads, no I/O, no side effects.
 */

/** Standing freshness label for the would-load surfaces (A8, R7.2/R7.3). */
export const EFFECTIVE_AFTER_RESTART = "effective after next restart";

/** Header order of the table; the snapshot renders the same five cells. */
export const TABLE_COLUMNS = Object.freeze([
  "path",
  "event",
  "class",
  "interpreter",
  "status",
] as const);

export interface HookReportRow {
  readonly path: string;
  readonly event: string;
  readonly class: string;
  readonly interpreter: string;
  readonly status: string;
}

/**
 * Accepts a live registry snapshot (`entries` only) or a CLI would-load scan
 * (digest entries normalized through `buildRegistry`, plus its `failures`);
 * `bypassed` renders the disabled-scan state and `divergence` adds an
 * optional context note.
 */
export interface HookReportInput {
  readonly entries: readonly HookRegistryEntry[];
  readonly failures?: readonly HookValidationFailure[];
  readonly bypassed?: boolean;
  readonly divergence?: string;
}

const STATUS_LABELS: Readonly<Record<HookRegistryEntry["status"], string>> =
  Object.freeze({
    registered: "registered",
    "will-fail-closed": "will fail closed at fire",
    "skipped-no-interpreter": "skipped (no interpreter)",
  });

export const buildReportRows = (
  input: HookReportInput,
): readonly HookReportRow[] => {
  const rows: HookReportRow[] = [];
  if (input.bypassed === true) {
    rows.push({
      path: "(all hooks)",
      event: "-",
      class: "-",
      interpreter: "-",
      status: "hooks bypassed (OWFLOW_HOOKS_DISABLED=1)",
    });
  }
  for (const entry of input.entries) {
    rows.push({
      path: entry.path,
      event: entry.event,
      class: entry.class,
      interpreter: interpreterLabel(entry.interpreter),
      status: STATUS_LABELS[entry.status],
    });
  }
  for (const failure of input.failures ?? []) {
    rows.push({
      path: failure.path,
      event: "-",
      class: "-",
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
      row.class,
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
  if (input.divergence !== undefined) lines.push(input.divergence);
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
      `[owflow]   ${row.path} -> ${row.event} [${row.class}] ${row.interpreter} - ${row.status}`,
    );
  }
  if (input.divergence !== undefined) {
    lines.push(`[owflow] ${input.divergence}`);
  }
  return lines;
};

export const renderJson = (input: HookReportInput): string =>
  JSON.stringify(
    {
      label: EFFECTIVE_AFTER_RESTART,
      bypassed: input.bypassed === true,
      ...(input.divergence !== undefined
        ? { divergence: input.divergence }
        : {}),
      rows: buildReportRows(input),
    },
    null,
    2,
  );
