import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { digest } from "../../hooks-wrapper/digest.js";

describe("digest", () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir !== undefined) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  const makeHooksDir = (): string => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "owflow-hooks-test-"));
    const hooksDir = path.join(tempDir, ".owflow", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    return hooksDir;
  };

  test("should return an empty digest without throwing when the hooks directory is absent or empty", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "owflow-hooks-test-"));
    const hooksDir = path.join(tempDir, ".owflow", "hooks");

    expect(digest(hooksDir, "throw")).toEqual({ entries: [], failures: [] });

    fs.mkdirSync(hooksDir, { recursive: true });
    expect(digest(hooksDir, "throw")).toEqual({ entries: [], failures: [] });
    expect(digest(hooksDir, "report")).toEqual({ entries: [], failures: [] });
  });

  test("should fail fast on every invalid entry and collect all violations without throwing in report mode", () => {
    const hooksDir = makeHooksDir();

    fs.writeFileSync(path.join(hooksDir, "tool-execute-before.ts"), "");
    fs.writeFileSync(path.join(hooksDir, "tool-execute-befor.ts"), "");
    fs.writeFileSync(path.join(hooksDir, "permission-ask.ts"), "");
    fs.writeFileSync(path.join(hooksDir, "bad_stem.ts"), "");
    fs.writeFileSync(path.join(hooksDir, "readme.md"), "");
    fs.mkdirSync(path.join(hooksDir, "notes"));

    const failurePaths = [
      path.join(hooksDir, "bad_stem.ts"),
      path.join(hooksDir, "notes"),
      path.join(hooksDir, "permission-ask.ts"),
      path.join(hooksDir, "readme.md"),
      path.join(hooksDir, "tool-execute-befor.ts"),
    ];

    expect(() => digest(hooksDir, "throw")).toThrow();
    try {
      digest(hooksDir, "throw");
      throw new Error("expected the digest to fail fast");
    } catch (error) {
      const message = (error as Error).message;
      expect(message.startsWith("[owflow]")).toBe(true);
      expect(message).toContain("Hint:");
      expect(message).toContain("restart");
      expect(message).toContain("OWFLOW_HOOKS_DISABLED=1");
      for (const failurePath of failurePaths) {
        expect(message).toContain(failurePath);
      }
    }

    const report = digest(hooksDir, "report");
    expect(report.failures.map((failure) => failure.path)).toEqual(failurePaths);
    for (const failure of report.failures) {
      expect(failure.error.length).toBeGreaterThan(0);
    }

    const errorFor = (name: string): string =>
      report.failures.find((failure) => failure.path.endsWith(name))!.error;
    expect(errorFor("bad_stem.ts")).toContain("kebab-case");
    expect(errorFor("notes")).toContain("regular file");
    expect(errorFor("permission-ask.ts")).toContain("excluded");
    expect(errorFor("readme.md")).toContain("routable");
    expect(errorFor("tool-execute-befor.ts")).toContain(
      "not a dispatchable event",
    );
    expect(errorFor("tool-execute-befor.ts")).toContain("tool.execute.befor");

    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]!.path).toBe(
      path.join(hooksDir, "tool-execute-before.ts"),
    );
    expect(report.entries[0]!.event).toBe("tool.execute.before");
    expect(report.entries[0]!.class).toBe("gate");
    expect(report.entries[0]!.runnerClass).toBe("in-process");
  });
});
