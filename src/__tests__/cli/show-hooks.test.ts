import { afterEach, describe, expect, spyOn, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runShowHooks } from "../../cli/show-hooks.js";
import { digest } from "../../hooks-wrapper/digest.js";
import { resolveInterpreterAvailability } from "../../hooks-wrapper/interpreters.js";
import { buildRegistry } from "../../hooks-wrapper/registry.js";
import type { HookReportInput } from "../../hooks-wrapper/report.js";
import {
  EFFECTIVE_AFTER_RESTART,
  renderJson,
  renderTable,
} from "../../hooks-wrapper/report.js";

describe("owflow-hooks CLI", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  const makeFixture = (): { root: string; hooksDir: string } => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "owflow-hooks-test-"));
    tempDirs.push(root);
    const hooksDir = path.join(root, ".owflow", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    return { root, hooksDir };
  };

  const capture = (): { lines: string[]; log: (line: string) => void } => {
    const lines: string[] = [];
    return { lines, log: (line) => lines.push(line) };
  };

  test("should render the would-load scan as a table with the restart label by default", () => {
    const { root, hooksDir } = makeFixture();
    fs.writeFileSync(path.join(hooksDir, "tool-execute-before.sh"), "");

    const consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const exitCode = runShowHooks({ cwd: root, argv: [] });

      expect(exitCode).toBe(0);
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const output = consoleLogSpy.mock.calls[0]![0] as string;
      expect(output).toContain(path.join(hooksDir, "tool-execute-before.sh"));
      expect(output).toContain("tool.execute.before");
      expect(output).toContain(EFFECTIVE_AFTER_RESTART);
    } finally {
      consoleLogSpy.mockRestore();
    }
  });

  test("should parse as JSON and keep the rows when --json is passed", () => {
    const { root, hooksDir } = makeFixture();
    fs.writeFileSync(path.join(hooksDir, "tool-execute-before.sh"), "");

    const { lines, log } = capture();
    const exitCode = runShowHooks({ cwd: root, argv: ["--json"], log });
    const parsed = JSON.parse(lines.join("\n")) as {
      label: string;
      rows: readonly { path: string; event: string }[];
    };

    expect(exitCode).toBe(0);
    expect(parsed.label).toBe(EFFECTIVE_AFTER_RESTART);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]!.path).toBe(
      path.join(hooksDir, "tool-execute-before.sh"),
    );
    expect(parsed.rows[0]!.event).toBe("tool.execute.before");
  });

  test("should include invalid entries as rows and exit non-zero for an invalid set", () => {
    const { root, hooksDir } = makeFixture();
    fs.writeFileSync(path.join(hooksDir, "tool-execute-before.ts"), "");
    fs.writeFileSync(path.join(hooksDir, "readme.md"), "");
    fs.writeFileSync(path.join(hooksDir, "BadName.sh"), "");

    const { lines, log } = capture();
    const tableCode = runShowHooks({ cwd: root, argv: [], log });
    const table = lines.join("\n");

    expect(tableCode).toBe(1);
    expect(table).toContain(path.join(hooksDir, "tool-execute-before.ts"));
    expect(table).toContain(path.join(hooksDir, "readme.md"));
    expect(table).toContain("invalid:");
    expect(table).toContain("not routable");
    expect(table).toContain(path.join(hooksDir, "BadName.sh"));
    expect(table).toContain("kebab-case");

    const { lines: jsonLines, log: jsonLog } = capture();
    const jsonCode = runShowHooks({ cwd: root, argv: ["--json"], log: jsonLog });
    const parsed = JSON.parse(jsonLines.join("\n")) as {
      rows: readonly { path: string; status: string }[];
    };

    expect(jsonCode).toBe(1);
    const invalidRows = parsed.rows.filter((row) =>
      row.status.startsWith("invalid:"),
    );
    expect(invalidRows.map((row) => row.path)).toEqual([
      path.join(hooksDir, "BadName.sh"),
      path.join(hooksDir, "readme.md"),
    ]);
  });

  test("should carry the restart label and match the shared renderers for the same fixture", () => {
    const { root, hooksDir } = makeFixture();
    fs.writeFileSync(path.join(hooksDir, "tool-execute-before.ts"), "");
    fs.writeFileSync(path.join(hooksDir, "config.sh"), "");

    const { lines, log } = capture();
    const tableCode = runShowHooks({ cwd: root, argv: [], log });
    const { lines: jsonLines, log: jsonLog } = capture();
    const jsonCode = runShowHooks({
      cwd: root,
      argv: ["--json"],
      log: jsonLog,
    });

    const scan = digest(hooksDir, "report");
    const registry = buildRegistry(
      scan.entries,
      resolveInterpreterAvailability(),
    );
    const input: HookReportInput = {
      entries: registry.entries,
      failures: scan.failures,
    };

    expect(tableCode).toBe(0);
    expect(jsonCode).toBe(0);
    expect(lines.join("\n")).toBe(renderTable(input));
    expect(lines.join("\n")).toContain(EFFECTIVE_AFTER_RESTART);
    expect(jsonLines.join("\n")).toBe(renderJson(input));
    expect(jsonLines.join("\n")).toContain(EFFECTIVE_AFTER_RESTART);
  });
});
