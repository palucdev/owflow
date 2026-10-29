import { afterEach, describe, expect, spyOn, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createHookLogStore,
  hooksLogFile,
  LOG_FILE_ENV,
  MAX_CAPTURE_BYTES,
  MAX_LOG_READ_BYTES,
  MAX_LOG_RECORD_BYTES,
  readHookLogRecords,
  readLatestHookLog,
  resolveHooksLogFile,
} from "../../hooks-wrapper/hook-logs.js";
import {
  hooksStatusFile,
  opencodeTmpDirectory,
  workspaceStatusKey,
} from "../../hooks-wrapper/status.js";
import type {
  HookEventName,
  HookRegistryEntry,
  HookRunLogReport,
} from "../../types/hook-types.js";

const tempDirs: string[] = [];

const makeTempDir = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "owflow-logs-test-"));
  tempDirs.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const entry = (
  event: HookEventName = "tool.execute.before",
  hookClass: HookRegistryEntry["class"] = "gate",
): HookRegistryEntry => ({
  path: `/project/.owflow/hooks/${event.replaceAll(".", "-")}.sh`,
  event,
  class: hookClass,
  interpreter: { resolved: "/usr/bin/bash", available: true },
  status: "registered",
});

const report = (
  overrides: Partial<HookRunLogReport> = {},
): HookRunLogReport => ({
  entry: entry(),
  runId: "tool.execute.before#1",
  phase: "settled",
  outcome: { status: "ok" },
  sessionID: "ses_abc",
  startedAt: 1_000,
  finishedAt: 1_123,
  ...overrides,
});

const writeLines = (file: string, lines: readonly unknown[]): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    lines.map((line) => `${JSON.stringify(line)}\n`).join(""),
    "utf8",
  );
};

const parseLine = (line: string): Record<string, unknown> =>
  JSON.parse(line) as Record<string, unknown>;

const rawLines = (file: string): string[] =>
  fs.readFileSync(file, "utf8").trim().split("\n");

describe("log path", () => {
  test("should build a per-workspace JSONL path distinct from the status snapshot", () => {
    const workspace = makeTempDir();
    const file = hooksLogFile(workspace);

    expect(path.dirname(file)).toBe(opencodeTmpDirectory());
    expect(path.basename(file)).toMatch(
      /^owflow-hook-logs-[0-9a-f]{16}\.jsonl$/,
    );
    expect(file).not.toBe(hooksStatusFile(workspace));
    expect(path.basename(file)).toContain(workspaceStatusKey(workspace));
  });

  test("should honor the test/debug log-file override", () => {
    const previous = process.env[LOG_FILE_ENV];
    process.env[LOG_FILE_ENV] = "/tmp/custom-hook-logs.jsonl";
    try {
      expect(resolveHooksLogFile(makeTempDir())).toBe(
        "/tmp/custom-hook-logs.jsonl",
      );
    } finally {
      if (previous === undefined) delete process.env[LOG_FILE_ENV];
      else process.env[LOG_FILE_ENV] = previous;
    }
  });
});

describe("log writer", () => {
  test("should append one newline-terminated JSON record with round-tripped metadata", () => {
    const directory = makeTempDir();
    const file = path.join(directory, "logs.jsonl");
    const store = createHookLogStore({
      file,
      workspace: "/project",
      pid: 1234,
    });

    store.record(
      report({
        outcome: {
          status: "failed",
          reason: "missing jq",
          capture: { stderr: "boom\n", exitCode: 3 },
        },
        capture: { stderr: "boom\n", exitCode: 3 },
        reason: "missing jq",
      }),
    );

    expect(fs.existsSync(file)).toBe(true);
    if (process.platform !== "win32") {
      expect(fs.lstatSync(file).mode & 0o777).toBe(0o600);
    }
    const lines = rawLines(file);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.endsWith("}")).toBe(true);

    const record = parseLine(lines[0]!);
    expect(record).toMatchObject({
      version: 1,
      runId: "tool.execute.before#1",
      pid: 1234,
      workspace: "/project",
      event: "tool.execute.before",
      hook: "/project/.owflow/hooks/tool-execute-before.sh",
      name: "tool-execute-before",
      class: "gate",
      sessionID: "ses_abc",
      startedAt: 1_000,
      finishedAt: 1_123,
      durationMs: 123,
      status: "failure",
      outcome: "failed",
      reason: "missing jq",
      exitCode: 3,
      stderr: "boom\n",
    });
    expect(record).not.toHaveProperty("runnerClass");
    expect(record).not.toHaveProperty("errorStack");

    const read = readHookLogRecords(file);
    expect(read.kind).toBe("ok");
    if (read.kind === "ok") {
      expect(read.truncated).toBe(false);
      expect(read.records).toHaveLength(1);
      expect(read.records[0]).toMatchObject({
        runId: "tool.execute.before#1",
        stderr: "boom\n",
      });
    }

    store.dispose();
  });

  test("should omit absent optional fields and treat skipped runs as failures", () => {
    const directory = makeTempDir();
    const file = path.join(directory, "logs.jsonl");
    const store = createHookLogStore({ file, workspace: "/project", pid: 1 });

    store.record(
      report({
        phase: "skipped",
        outcome: undefined,
        reason: "bash is not available",
        sessionID: undefined,
      }),
    );

    const record = parseLine(rawLines(file)[0]!);
    expect(record.status).toBe("failure");
    expect(record.outcome).toBe("failed");
    expect(record.reason).toBe("bash is not available");
    expect(record).not.toHaveProperty("exitCode");
    expect(record).not.toHaveProperty("signal");
    expect(record).not.toHaveProperty("stdout");
    expect(record).not.toHaveProperty("stderr");
    expect(record).not.toHaveProperty("runnerClass");
    expect(record).not.toHaveProperty("errorStack");
    expect(record).not.toHaveProperty("sessionID");
    expect(record).not.toHaveProperty("truncated");
  });

  test("should coalesce consecutive identical runs and log again after a change", () => {
    const directory = makeTempDir();
    const file = path.join(directory, "logs.jsonl");
    const store = createHookLogStore({ file, workspace: "/project", pid: 1 });
    const failure = report({
      runId: "run#1",
      startedAt: 1,
      finishedAt: 2,
      outcome: { status: "failed", reason: "missing script" },
      reason: "missing script",
      capture: { stderr: "missing script\n", exitCode: 127 },
    });

    store.record(failure);
    store.record({ ...failure, runId: "run#2", startedAt: 3, finishedAt: 4 });
    store.record({
      ...failure,
      runId: "run#3",
      startedAt: 5,
      finishedAt: 6,
      sessionID: "ses_other",
    });
    store.record(report({ runId: "run#4", startedAt: 7, finishedAt: 8 }));

    const records = rawLines(file).map(parseLine);
    expect(records.map((record) => record.runId)).toEqual([
      "run#1",
      "run#3",
      "run#4",
    ]);
    expect(records[0]?.startedAt).toBe(1);
    expect(records[0]?.finishedAt).toBe(2);
  });

  test("should cap a captured stream and mark the record truncated", () => {
    const directory = makeTempDir();
    const file = path.join(directory, "logs.jsonl");
    const store = createHookLogStore({ file, workspace: "/project", pid: 1 });

    store.record(
      report({
        capture: { stderr: "e".repeat(40_000), exitCode: 0 },
      }),
    );

    const record = parseLine(rawLines(file)[0]!);
    expect(Buffer.byteLength(record.stderr as string, "utf8")).toBe(
      MAX_CAPTURE_BYTES,
    );
    expect(record.truncated).toBe(true);
  });

  test("should cap the whole record while keeping valid JSON", () => {
    const directory = makeTempDir();
    const file = path.join(directory, "logs.jsonl");
    const store = createHookLogStore({ file, workspace: "/project", pid: 1 });

    store.record(
      report({
        outcome: { status: "failed", reason: "x".repeat(40_000) },
        reason: "x".repeat(40_000),
        capture: {
          stdout: "o".repeat(40_000),
          stderr: "e".repeat(40_000),
          exitCode: 1,
          truncated: false,
        },
      }),
    );

    const line = rawLines(file)[0]!;
    expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(
      MAX_LOG_RECORD_BYTES,
    );
    const record = parseLine(line);
    expect(record.truncated).toBe(true);
    const stderr = record.stderr;
    expect(typeof stderr === "string" ? Buffer.byteLength(stderr) : 0).toBeLessThanOrEqual(
      MAX_CAPTURE_BYTES,
    );
  });

  test("should rotate to exactly one .1 file at the file cap", () => {
    const directory = makeTempDir();
    const file = path.join(directory, "logs.jsonl");
    const store = createHookLogStore({
      file,
      workspace: "/project",
      pid: 1,
      maxFileBytes: 10,
    });

    store.record(
      report({ runId: "run#1", startedAt: 1, finishedAt: 1, reason: "run 1" }),
    );
    store.record(
      report({ runId: "run#2", startedAt: 2, finishedAt: 2, reason: "run 2" }),
    );
    store.record(
      report({ runId: "run#3", startedAt: 3, finishedAt: 3, reason: "run 3" }),
    );

    expect(fs.existsSync(`${file}.1`)).toBe(true);
    expect(fs.readdirSync(directory).sort()).toEqual([
      "logs.jsonl",
      "logs.jsonl.1",
    ]);

    const backup = parseLine(rawLines(`${file}.1`)[0]!);
    expect(backup.runId).toBe("run#2");
    const current = parseLine(rawLines(file)[0]!);
    expect(current.runId).toBe("run#3");
  });

  test("should swallow append failures and warn only once", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const store = createHookLogStore({
        file: "/tmp/unwritable.jsonl",
        append: () => {
          throw new Error("disk full");
        },
      });

      store.record(report());
      store.record(report());
      store.dispose();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("disk full");
    } finally {
      warn.mockRestore();
    }
  });

  test("should refuse to append when log file or .1 backup is a symlink", () => {
    const directory = makeTempDir();
    const target = path.join(directory, "victim.txt");
    fs.writeFileSync(target, "original", "utf8");
    const symlinkFile = path.join(directory, "logs.jsonl");
    fs.symlinkSync(target, symlinkFile);

    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const store = createHookLogStore({
        file: symlinkFile,
        workspace: "/project",
        pid: 1,
      });
      store.record(report());
      store.dispose();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain(
        "refusing to write non-regular file or symlink",
      );
      expect(fs.readFileSync(target, "utf8")).toBe("original");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("log reader", () => {
  test("should skip malformed lines while returning valid neighbors", () => {
    const directory = makeTempDir();
    const file = path.join(directory, "logs.jsonl");
    const valid = (runId: string, finishedAt: number) => ({
      ...report({ runId, startedAt: 1, finishedAt }),
      version: 1,
      pid: 1,
      workspace: "/project",
      event: "tool.execute.before",
      hook: "/project/.owflow/hooks/tool-execute-before.sh",
      name: "tool-execute-before",
      class: "gate",
      durationMs: 0,
      status: "success",
      outcome: "ok",
    });

    fs.writeFileSync(
      file,
      `${JSON.stringify(valid("run#1", 10))}\nnot json\n${JSON.stringify(valid("run#2", 20))}\n{partial`,
      "utf8",
    );

    const read = readHookLogRecords(file);
    expect(read.kind).toBe("ok");
    if (read.kind === "ok") {
      expect(read.records.map((record) => record.runId)).toEqual([
        "run#1",
        "run#2",
      ]);
    }
  });

  test("should keep reading pre-simplification records that still carry runnerClass and errorStack", () => {
    const directory = makeTempDir();
    const file = path.join(directory, "logs.jsonl");
    const legacy = {
      ...report({ runId: "legacy#1", startedAt: 1, finishedAt: 2 }),
      version: 1,
      pid: 1,
      workspace: "/project",
      event: "tool.execute.before",
      hook: "/project/.owflow/hooks/tool-execute-before.ts",
      name: "tool-execute-before",
      runnerClass: "in-process",
      class: "gate",
      durationMs: 1,
      status: "success",
      outcome: "ok",
      errorStack: "Error: legacy",
    };

    writeLines(file, [legacy]);

    const read = readHookLogRecords(file);
    expect(read.kind).toBe("ok");
    if (read.kind === "ok") {
      expect(read.records).toHaveLength(1);
      expect(read.records[0]).toMatchObject({
        runId: "legacy#1",
        event: "tool.execute.before",
      });
    }
  });

  test("should select the newest finishedAt for the requested event and ignore others", () => {
    const directory = makeTempDir();
    const file = path.join(directory, "logs.jsonl");
    const record = (
      event: HookEventName,
      runId: string,
      finishedAt: number,
      reason: string,
    ) => ({
      ...report({
        entry: entry(event),
        runId,
        startedAt: finishedAt,
        finishedAt,
        reason,
        outcome: { status: "ok" },
      }),
      version: 1,
      pid: 1,
      workspace: "/project",
      event,
      hook: entry(event).path,
      name: "hook",
      class: "gate",
      durationMs: 0,
      status: "success",
      outcome: "ok",
    });

    writeLines(file, [
      record("tool.execute.before", "a", 10, "old"),
      record("config", "c", 99, "other event"),
      record("tool.execute.before", "b", 30, "new"),
      record("tool.execute.before", "tie-later", 30, "tie"),
    ]);

    const latest = readLatestHookLog(file, "tool.execute.before");
    expect(latest?.reason).toBe("tie");
    expect(readLatestHookLog(file, "event")).toBeUndefined();
    expect(readLatestHookLog(file, "tool.execute.before", 31)).toBeUndefined();
    expect(readLatestHookLog(file, "tool.execute.before", 30)?.reason).toBe(
      "tie",
    );
  });

  test("should persist and read an event-named hook record", () => {
    const directory = makeTempDir();
    const file = path.join(directory, "logs.jsonl");
    const store = createHookLogStore({
      file,
      workspace: "/project",
      pid: 42,
    });

    store.record(
      report({
        entry: entry("session.idle", "observe"),
        runId: "session.idle#1",
        capture: { stderr: "idle\n" },
      }),
    );

    const read = readHookLogRecords(file);
    expect(read.kind).toBe("ok");
    if (read.kind === "ok") {
      expect(read.records[0]).toMatchObject({
        event: "session.idle",
        name: "session-idle",
        class: "observe",
        stderr: "idle\n",
      });
    }
    expect(readLatestHookLog(file, "session.idle")?.runId).toBe(
      "session.idle#1",
    );
  });

  test("should return safe results for missing, invalid, empty, and oversized files", () => {
    const directory = makeTempDir();
    const file = path.join(directory, "logs.jsonl");

    expect(readHookLogRecords(file)).toEqual({ kind: "missing" });
    expect(readHookLogRecords(directory)).toEqual({ kind: "invalid" });

    const realLog = path.join(directory, "real-logs.jsonl");
    fs.writeFileSync(realLog, "", "utf8");
    const symlinkLog = path.join(directory, "symlink-logs.jsonl");
    fs.symlinkSync(realLog, symlinkLog);
    expect(readHookLogRecords(symlinkLog)).toEqual({ kind: "invalid" });

    fs.writeFileSync(file, "", "utf8");
    expect(readHookLogRecords(file)).toEqual({
      kind: "ok",
      records: [],
      truncated: false,
    });

    const valid = JSON.stringify({
      ...report({ runId: "tail#1", startedAt: 1, finishedAt: 2 }),
      version: 1,
      pid: 1,
      workspace: "/project",
      event: "tool.execute.before",
      hook: "/project/.owflow/hooks/tool-execute-before.sh",
      name: "tool-execute-before",
      class: "gate",
      durationMs: 1,
      status: "success",
      outcome: "ok",
    });
    fs.writeFileSync(
      file,
      `${"x".repeat(MAX_LOG_READ_BYTES + 100)}\n${valid}\n`,
      "utf8",
    );

    const read = readHookLogRecords(file);
    expect(read.kind).toBe("ok");
    if (read.kind === "ok") {
      expect(read.truncated).toBe(true);
      expect(read.records.map((record) => record.runId)).toEqual(["tail#1"]);
    }
  });
});
