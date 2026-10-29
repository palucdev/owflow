import { afterEach, describe, expect, spyOn, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createHookStatusStore,
  hooksStatusFile,
  MAX_STATUS_FILE_BYTES,
  opencodeTmpDirectory,
  readHookStatusSnapshot,
  resolveHooksStatusFile,
  workspaceStatusKey,
} from "../../hooks-wrapper/status.js";
import type {
  DispatchableEvent,
  HookRegistryEntry,
  HookStatusReport,
} from "../../types/hook-types.js";

const tempDirs: string[] = [];

const makeTempDir = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "owflow-status-test-"));
  tempDirs.push(directory);
  return directory;
};

const entry = (
  event: DispatchableEvent = "tool.execute.before",
): HookRegistryEntry => ({
  path: `/project/.owflow/hooks/${event.replaceAll(".", "-")}.sh`,
  event,
  class: "gate",
  interpreter: { resolved: "/usr/bin/bash", available: true },
  status: "registered",
});

const pending = (
  event: DispatchableEvent,
  runId: string,
): HookStatusReport => ({
  entry: entry(event),
  phase: "pending",
  runId,
});

const settled = (
  event: DispatchableEvent,
  runId: string,
  status: "ok" | "blocked" | "failed",
  reason?: string,
): HookStatusReport => ({
  entry: entry(event),
  phase: "settled",
  runId,
  outcome: { status, ...(reason !== undefined ? { reason } : {}) },
  ...(reason !== undefined ? { reason } : {}),
});

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("status path", () => {
  test("should build a stable per-workspace file in OpenCode tmp space", () => {
    const first = makeTempDir();
    const second = makeTempDir();

    const file = hooksStatusFile(first);
    expect(file).toBe(hooksStatusFile(first));
    expect(path.dirname(file)).toBe(opencodeTmpDirectory());
    expect(path.basename(file)).toMatch(/^owflow-hooks-[0-9a-f]{16}\.json$/);
    expect(workspaceStatusKey(first)).toMatch(/^[0-9a-f]{16}$/);
    expect(hooksStatusFile(second)).not.toBe(file);
  });

  test("should honor the test/debug status-file override", () => {
    const previous = process.env.OWFLOW_HOOKS_STATUS_FILE;
    process.env.OWFLOW_HOOKS_STATUS_FILE = "/tmp/custom-status.json";
    try {
      expect(resolveHooksStatusFile(makeTempDir())).toBe(
        "/tmp/custom-status.json",
      );
    } finally {
      if (previous === undefined) delete process.env.OWFLOW_HOOKS_STATUS_FILE;
      else process.env.OWFLOW_HOOKS_STATUS_FILE = previous;
    }
  });
});

describe("status store", () => {
  test("should write one atomic snapshot and overwrite it without accumulation", () => {
    const directory = makeTempDir();
    const file = path.join(directory, "status.json");
    const store = createHookStatusStore({ file, workspace: "/project" });

    expect(fs.readdirSync(directory)).toEqual(["status.json"]);
    expect(readHookStatusSnapshot(file)).toEqual({
      kind: "ok",
      snapshot: {
        version: 1,
        pid: process.pid,
        workspace: "/project",
        updatedAt: expect.any(Number),
        hooks: {},
      },
    });

    store.observe(pending("tool.execute.before", "run#1"));
    store.flushNow();
    store.observe(settled("tool.execute.before", "run#1", "ok"));
    store.flushNow();

    expect(fs.readdirSync(directory)).toEqual(["status.json"]);
    if (process.platform !== "win32") {
      expect(fs.lstatSync(file).mode & 0o777).toBe(0o600);
    }
    const read = readHookStatusSnapshot(file);
    expect(read.kind).toBe("ok");
    if (read.kind === "ok") {
      expect(read.snapshot.hooks["tool.execute.before"]?.status).toBe("success");
    }
    store.dispose();
  });

  test("should refuse to overwrite a symlink target at status file or .tmp path", () => {
    const directory = makeTempDir();
    const target = path.join(directory, "victim.txt");
    fs.writeFileSync(target, "original", "utf8");
    const symlinkFile = path.join(directory, "status.json");
    fs.symlinkSync(target, symlinkFile);

    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const store = createHookStatusStore({
        file: symlinkFile,
        workspace: "/project",
      });
      store.observe(pending("tool.execute.before", "run#1"));
      store.flushNow();
      store.dispose();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain(
        "refusing to write non-regular file or symlink",
      );
      expect(fs.readFileSync(target, "utf8")).toBe("original");

      // Also verify .tmp symlink rejection
      fs.rmSync(symlinkFile);
      const tmpSymlink = `${symlinkFile}.tmp`;
      fs.symlinkSync(target, tmpSymlink);
      const store2 = createHookStatusStore({
        file: symlinkFile,
        workspace: "/project",
      });
      store2.dispose();
      expect(fs.readFileSync(target, "utf8")).toBe("original");
    } finally {
      warn.mockRestore();
    }
  });

  test("should transition pending to success and pending to failure", () => {
    let current = 1_000;
    const writes: string[] = [];
    const store = createHookStatusStore({
      file: "/tmp/status.json",
      workspace: "/project",
      now: () => current,
      write: (_file, data) => writes.push(data),
    });

    store.observe(pending("tool.execute.before", "run#1"));
    expect(store.snapshot().hooks["tool.execute.before"]).toEqual({
      status: "pending",
      startedAt: 1_000,
    });

    current = 1_123;
    store.observe(settled("tool.execute.before", "run#1", "ok"));
    expect(store.snapshot().hooks["tool.execute.before"]).toEqual({
      status: "success",
      startedAt: 1_000,
      finishedAt: 1_123,
      durationMs: 123,
    });

    current = 2_000;
    store.observe(pending("event", "run#2"));
    current = 2_040;
    store.observe(settled("event", "run#2", "blocked", "policy says no"));
    expect(store.snapshot().hooks["event"]).toEqual({
      status: "failure",
      startedAt: 2_000,
      finishedAt: 2_040,
      durationMs: 40,
      reason: "policy says no",
    });

    store.dispose();
    expect(writes.length).toBe(2);
  });

  test("should stay pending until the last concurrent run of an event settles", () => {
    let current = 1_000;
    const store = createHookStatusStore({
      file: "/tmp/status.json",
      now: () => current,
      write: () => {},
    });

    store.observe(pending("tool.execute.before", "run#1"));
    current = 1_010;
    store.observe(pending("tool.execute.before", "run#2"));

    current = 1_050;
    store.observe(settled("tool.execute.before", "run#1", "ok"));
    expect(store.snapshot().hooks["tool.execute.before"]?.status).toBe(
      "pending",
    );

    current = 1_080;
    store.observe(settled("tool.execute.before", "run#2", "failed", "boom"));
    expect(store.snapshot().hooks["tool.execute.before"]).toEqual({
      status: "failure",
      startedAt: 1_000,
      finishedAt: 1_080,
      durationMs: 80,
      reason: "boom",
    });

    store.dispose();
  });

  test("should accept a settled observe fire without a pending phase", () => {
    let current = 5_000;
    const store = createHookStatusStore({
      file: "/tmp/status.json",
      now: () => current,
      write: () => {},
    });
    const fire = (runId: string, startedAt: number): HookStatusReport => ({
      entry: { ...entry("event"), class: "observe" },
      phase: "settled",
      runId,
      outcome: { status: "ok" },
      startedAt,
    });

    store.observe(fire("event#1", 4_900));
    expect(store.snapshot().hooks["event"]).toEqual({
      status: "success",
      startedAt: 4_900,
      finishedAt: 5_000,
      durationMs: 100,
    });

    current = 6_000;
    store.observe(fire("event#2", 5_950));
    expect(store.snapshot().hooks["event"]).toEqual({
      status: "success",
      startedAt: 5_950,
      finishedAt: 6_000,
      durationMs: 50,
    });

    store.dispose();
  });

  test("should clear a silent observe run and restore the previous outcome", () => {
    let current = 5_000;
    const store = createHookStatusStore({
      file: "/tmp/status.json",
      now: () => current,
      write: () => {},
    });
    const fire = (runId: string, startedAt: number): HookStatusReport => ({
      entry: { ...entry("event"), class: "observe" },
      phase: "settled",
      runId,
      outcome: { status: "ok" },
      startedAt,
    });
    const silent = (runId: string): HookStatusReport => ({
      entry: { ...entry("event"), class: "observe" },
      phase: "settled",
      runId,
      startedAt: 5_100,
      noop: true,
    });

    store.observe(fire("event#1", 4_900));
    expect(store.snapshot().hooks["event"]?.status).toBe("success");

    current = 5_100;
    store.observe(pending("event", "event#2"));
    expect(store.snapshot().hooks["event"]?.status).toBe("pending");

    current = 5_101;
    store.observe(silent("event#2"));
    expect(store.snapshot().hooks["event"]).toEqual({
      status: "success",
      startedAt: 4_900,
      finishedAt: 5_000,
      durationMs: 100,
    });

    store.dispose();
  });

  test("should leave an event idle when its only run was silent", () => {
    const store = createHookStatusStore({
      file: "/tmp/status.json",
      now: () => 1_000,
      write: () => {},
    });

    store.observe(pending("event", "event#1"));
    expect(store.snapshot().hooks["event"]?.status).toBe("pending");
    store.observe({
      entry: { ...entry("event"), class: "observe" },
      phase: "settled",
      runId: "event#1",
      startedAt: 1_000,
      noop: true,
    });

    expect(store.snapshot().hooks["event"]).toBeUndefined();
    store.dispose();
  });

  test("should keep a real outcome when a concurrent silent run settles last", () => {
    let current = 1_000;
    const store = createHookStatusStore({
      file: "/tmp/status.json",
      now: () => current,
      write: () => {},
    });

    store.observe(pending("event", "event#1"));
    store.observe(pending("event", "event#2"));
    current = 1_050;
    store.observe(settled("event", "event#1", "ok"));
    expect(store.snapshot().hooks["event"]?.status).toBe("pending");
    store.observe({
      entry: { ...entry("event"), class: "observe" },
      phase: "settled",
      runId: "event#2",
      startedAt: 1_000,
      noop: true,
    });

    expect(store.snapshot().hooks["event"]).toEqual({
      status: "success",
      startedAt: 1_000,
      finishedAt: 1_050,
      durationMs: 50,
    });
    store.dispose();
  });

  test("should record a skipped hook as an immediate failure with a reason", () => {
    const store = createHookStatusStore({
      file: "/tmp/status.json",
      now: () => 5_000,
      write: () => {},
    });

    store.observe({
      entry: entry("config"),
      phase: "skipped",
      reason: "bash is not available",
    });

    expect(store.snapshot().hooks["config"]).toEqual({
      status: "failure",
      startedAt: 5_000,
      finishedAt: 5_000,
      durationMs: 0,
      reason: "bash is not available",
    });
    store.dispose();
  });

  test("should coalesce rapid updates into one trailing flush", async () => {
    const writes: string[] = [];
    const store = createHookStatusStore({
      file: "/tmp/status.json",
      flushMs: 60,
      write: (_file, data) => writes.push(data),
    });

    store.observe(pending("event", "run#1"));
    store.observe(settled("event", "run#1", "ok"));
    store.observe(pending("event", "run#2"));

    expect(writes).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(writes).toHaveLength(2);
    const last = JSON.parse(writes[1]!) as {
      hooks: Record<string, { status: string }>;
    };
    expect(last.hooks["event"]?.status).toBe("pending");

    store.dispose();
  });

  test("should swallow write failures and warn only once", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const store = createHookStatusStore({
        file: "/tmp/status.json",
        write: () => {
          throw new Error("disk full");
        },
      });

      store.observe(pending("event", "run#1"));
      store.flushNow();
      store.flushNow();
      store.dispose();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("disk full");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("status reader", () => {
  test("should return missing, invalid, or a validated snapshot without throwing", () => {
    const directory = makeTempDir();
    const file = path.join(directory, "status.json");

    expect(readHookStatusSnapshot(file)).toEqual({ kind: "missing" });

    fs.writeFileSync(file, "{not json", "utf8");
    expect(readHookStatusSnapshot(file)).toEqual({ kind: "invalid" });

    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        pid: 1,
        workspace: "/project",
        updatedAt: 1,
        hooks: {},
      }),
      "utf8",
    );
    expect(readHookStatusSnapshot(file)).toEqual({ kind: "invalid" });

    fs.writeFileSync(file, "x".repeat(MAX_STATUS_FILE_BYTES + 1), "utf8");
    expect(readHookStatusSnapshot(file)).toEqual({ kind: "invalid" });

    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        pid: 1,
        workspace: "/project",
        updatedAt: 1,
        hooks: {
          event: { status: "pending", startedAt: 1 },
          config: { status: "nope", startedAt: 1 },
        },
      }),
      "utf8",
    );
    expect(readHookStatusSnapshot(file)).toEqual({ kind: "invalid" });

    const snapshot = {
      version: 1,
      pid: 1,
      workspace: "/project",
      updatedAt: 1,
      hooks: {
        event: { status: "success", startedAt: 1, finishedAt: 2, durationMs: 1 },
      },
    };
    fs.writeFileSync(file, JSON.stringify(snapshot), "utf8");
    expect(readHookStatusSnapshot(file)).toEqual({ kind: "ok", snapshot });
  });

  test("should reject directory paths and unreadable entries safely", () => {
    const directory = makeTempDir();
    expect(readHookStatusSnapshot(directory)).toEqual({ kind: "invalid" });

    const target = path.join(directory, "real-status.json");
    fs.writeFileSync(
      target,
      JSON.stringify({
        version: 1,
        pid: 1,
        workspace: "/project",
        updatedAt: 1,
        hooks: {},
      }),
      "utf8",
    );
    const link = path.join(directory, "symlink-status.json");
    fs.symlinkSync(target, link);
    expect(readHookStatusSnapshot(link)).toEqual({ kind: "invalid" });
  });
});
