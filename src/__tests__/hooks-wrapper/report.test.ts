import { describe, expect, test } from "bun:test";
import { buildRegistry } from "../../hooks-wrapper/registry.js";
import type {
  HookScript,
  InterpreterAvailability,
} from "../../hooks-wrapper/registry.js";
import type {
  HookReportInput,
  HookReportRow,
} from "../../hooks-wrapper/report.js";
import {
  EFFECTIVE_AFTER_RESTART,
  TABLE_COLUMNS,
  buildReportRows,
  renderJson,
  renderSnapshot,
  renderTable,
} from "../../hooks-wrapper/report.js";

const AVAILABLE: InterpreterAvailability = {
  ".sh": { resolved: "bash", available: true },
  ".ps1": { resolved: "pwsh", available: true },
};

const PS1_UNAVAILABLE: InterpreterAvailability = {
  ".sh": { resolved: "bash", available: true },
  ".ps1": { expected: "pwsh", available: false },
};

const script = (overrides: Partial<HookScript>): HookScript => ({
  path: "/hooks/tool-execute-before.sh",
  stem: "tool-execute-before",
  event: "tool.execute.before",
  class: "gate",
  extension: ".sh",
  ...overrides,
});

const cellsOf = (row: HookReportRow): readonly string[] => [
  row.path,
  row.event,
  row.class,
  row.interpreter,
  row.status,
];

describe("report formatting", () => {
  test("should render identical rows across snapshot, table, and JSON for the same input", () => {
    const registry = buildRegistry(
      [
        script({
          path: "/hooks/chat-message.sh",
          stem: "chat-message",
          event: "chat.message",
        }),
        script({
          path: "/hooks/config.sh",
          stem: "config",
          event: "config",
          class: "observe",
          extension: ".sh",
        }),
      ],
      AVAILABLE,
    );
    const input: HookReportInput = {
      entries: registry.entries,
      failures: [
        {
          path: "/hooks/bad_stem.ts",
          error: 'stem "bad_stem" is not lowercase kebab-case',
        },
      ],
    };

    const rows = buildReportRows(input);
    const table = renderTable(input);
    const snapshot = renderSnapshot(input);
    const json = JSON.parse(renderJson(input)) as {
      label: string;
      rows: readonly HookReportRow[];
    };

    expect(rows.map((row) => row.path)).toEqual([
      "/hooks/chat-message.sh",
      "/hooks/config.sh",
      "/hooks/bad_stem.ts",
    ]);
    expect(json.rows).toEqual([...rows]);
    expect(json.label).toBe(EFFECTIVE_AFTER_RESTART);

    for (const column of TABLE_COLUMNS) {
      expect(table.split("\n")[0]!).toContain(column);
    }
    expect(table).toContain(EFFECTIVE_AFTER_RESTART);

    for (const row of rows) {
      const cells = cellsOf(row);
      const tableRow = table.split("\n").find((line) => line.includes(row.path));
      expect(tableRow).toBeDefined();
      expect(tableRow!.split(/\s{2,}/)).toEqual([...cells]);

      const snapshotRow = snapshot.find((line) => line.includes(row.path));
      expect(snapshotRow).toBeDefined();
      for (const cell of cells) expect(snapshotRow!).toContain(cell);
    }

    // Pure and deterministic: the same input always renders byte-identically.
    expect(renderTable(input)).toBe(table);
    expect(renderJson(input)).toBe(renderJson(input));
    expect(renderSnapshot(input)).toEqual(snapshot);
  });

  test("should mark a gate entry with an unavailable interpreter as will fail closed at fire", () => {
    const registry = buildRegistry(
      [
        script({
          path: "/hooks/tool-execute-before.ps1",
          extension: ".ps1",
        }),
      ],
      PS1_UNAVAILABLE,
    );
    const input: HookReportInput = { entries: registry.entries };
    const row = buildReportRows(input)[0]!;

    expect(row.status).toBe("will fail closed at fire");
    expect(row.interpreter).toContain("pwsh");
    expect(row.interpreter).toContain("missing");
    expect(renderTable(input)).toContain("will fail closed at fire");
    expect(renderSnapshot(input).join("\n")).toContain(
      "will fail closed at fire",
    );
    expect(renderJson(input)).toContain("will fail closed at fire");
  });

  test("should render a bypass row when hook scanning is disabled", () => {
    const input: HookReportInput = { entries: [], bypassed: true };
    const rows = buildReportRows(input);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toContain("bypassed");
    expect(rows[0]!.status).toContain("OWFLOW_HOOKS_DISABLED=1");

    const json = JSON.parse(renderJson(input)) as {
      bypassed: boolean;
      rows: readonly HookReportRow[];
    };
    expect(json.bypassed).toBe(true);
    expect(json.rows).toEqual([...rows]);

    const surfaces = [
      renderTable(input),
      renderSnapshot(input).join("\n"),
      renderJson(input),
    ];
    for (const output of surfaces) {
      expect(output).toContain("bypassed");
      expect(output).toContain("OWFLOW_HOOKS_DISABLED=1");
    }
  });
});
