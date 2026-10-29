import { afterEach, describe, expect, spyOn, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildReportRows,
  buildStdinPayload,
  createDispatchHandlers,
  DISPATCHABLE_EVENTS,
  EFFECTIVE_AFTER_RESTART,
  EXCLUDED_EVENT_NAMES,
  HOOK_EVENT_NAMES,
  HOOK_TIMEOUT_ENV,
  HookDigestMode,
  HookEvent,
  HOST_EVENT_NAMES,
  initializeHooksWrapper,
  LOG_FILE_ENV,
  MAX_CAPTURE_BYTES,
  MAX_LOG_FILE_BYTES,
  readHookLogRecords,
  readHookStatusSnapshot,
  readLatestHookLog,
  renderJson,
  renderSnapshot,
  renderTable,
  resolveHooksLogFile,
  resolveHooksStatusFile,
  scanHooks,
  STATUS_FILE_ENV,
  TABLE_COLUMNS,
} from "../../hooks/user-hooks.js";

describe("user-hooks (consolidated user-hooks engine)", () => {
  const tempDirs: string[] = [];

  const makeTempDir = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "owflow-hooks-unit-"));
    tempDirs.push(dir);
    return dir;
  };

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("event tables pin 16 lifecycle events, 32 host events, and 5 excluded names", () => {
    expect(DISPATCHABLE_EVENTS).toHaveLength(16);
    expect(HOST_EVENT_NAMES).toHaveLength(32);
    expect(HOOK_EVENT_NAMES).toHaveLength(48);
    expect(EXCLUDED_EVENT_NAMES).toEqual([
      "permission.ask",
      "tool",
      "auth",
      "provider",
      "experimental.provider.small_model",
    ]);
  });

  test("scanHooks validates directory, stems, extensions, duplicates, and interpreter availability", () => {
    const root = makeTempDir();
    const missing = path.join(root, "absent");
    expect(scanHooks(missing)).toEqual({ entries: [], failures: [] });

    const notDir = path.join(root, "file-anchor");
    fs.writeFileSync(notDir, "x");
    expect(() => scanHooks(notDir)).toThrow(/not a directory/);
    expect(scanHooks(notDir, { mode: HookDigestMode.Report }).failures).toHaveLength(1);

    const hooksDir = path.join(root, ".owflow", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, "tool-execute-before.sh"), "");
    fs.writeFileSync(path.join(hooksDir, "session-idle.ps1"), "");

    const valid = scanHooks(hooksDir, {
      which: (cmd) => (cmd === "bash" ? "/bin/bash" : null),
    });
    expect(valid.failures).toEqual([]);
    expect(valid.entries).toEqual([
      {
        path: path.join(hooksDir, "session-idle.ps1"),
        event: "session.idle",
        interpreter: { expected: "pwsh", available: false },
        status: "will-fail-closed",
      },
      {
        path: path.join(hooksDir, "tool-execute-before.sh"),
        event: "tool.execute.before",
        interpreter: { expected: "bash", available: true, resolved: "/bin/bash" },
        status: "registered",
      },
    ]);

    // Add invalid files: directory, bad ext, bad stem, excluded, unknown, duplicate
    fs.mkdirSync(path.join(hooksDir, "subdir"));
    fs.writeFileSync(path.join(hooksDir, "readme.md"), "");
    fs.writeFileSync(path.join(hooksDir, "Bad_Name.sh"), "");
    fs.writeFileSync(path.join(hooksDir, "permission-ask.sh"), "");
    fs.writeFileSync(path.join(hooksDir, "unknown-event.sh"), "");
    fs.writeFileSync(path.join(hooksDir, "tool-execute-before.ps1"), "");

    expect(() => scanHooks(hooksDir)).toThrow(/invalid entries/);
    const report = scanHooks(hooksDir, { mode: HookDigestMode.Report });
    expect(report.entries.map((e) => e.event)).toEqual(["session.idle"]);
    expect(report.failures.length).toBe(7);
  });

  test("renderTable, renderSnapshot, and renderJson format rows consistently", () => {
    const input = {
      entries: [
        {
          path: "/p/config.sh",
          event: HookEvent.Config,
          interpreter: { expected: "bash", resolved: "/bin/bash", available: true },
          status: "registered" as const,
        },
        {
          path: "/p/dispose.ps1",
          event: HookEvent.Dispose,
          interpreter: { expected: "pwsh", available: false },
          status: "will-fail-closed" as const,
        },
      ],
      failures: [{ path: "/p/bad.ts", error: "not routable" }],
    };

    const rows = buildReportRows(input);
    expect(rows).toHaveLength(3);
    const table = renderTable(input);
    for (const col of TABLE_COLUMNS) expect(table).toContain(col);
    expect(table).toContain(EFFECTIVE_AFTER_RESTART);

    const snap = renderSnapshot(input);
    expect(snap[0]).toBe("[owflow] hooks: 2 loaded, 1 invalid");

    const json = JSON.parse(renderJson({ entries: [], bypassed: true }));
    expect(json.bypassed).toBe(true);
    expect(json.rows[0].status).toContain("OWFLOW_HOOKS_DISABLED=1");
  });

  test("buildStdinPayload strips class instance internals to identity keys and handles bigint", () => {
    class SecretModel {
      id = "claude-4";
      providerID = "anthropic";
      name = "Claude";
      apiKey = "sk-secret";
    }
    const raw = buildStdinPayload(
      HookEvent.ToolExecuteBefore,
      { tool: "bash", count: 42n, model: new SecretModel() },
      { args: { command: "ls" } },
      "ses_1",
    );
    expect(raw).not.toContain("sk-secret");
    expect(JSON.parse(raw)).toEqual({
      event: "tool.execute.before",
      session: { sessionID: "ses_1" },
      context: {
        tool: "bash",
        count: "42",
        model: { id: "claude-4", providerID: "anthropic", name: "Claude" },
        args: { command: "ls" },
      },
    });
  });

  test("status and log readers handle missing, invalid, symlink, rotation, and latest filtering", async () => {
    const root = makeTempDir();
    expect(resolveHooksStatusFile(root)).toContain("owflow-hooks-");
    expect(resolveHooksLogFile(root)).toContain("owflow-hook-logs-");

    const prevStatus = process.env[STATUS_FILE_ENV];
    const prevLog = process.env[LOG_FILE_ENV];
    process.env[STATUS_FILE_ENV] = "/tmp/override-status.json";
    process.env[LOG_FILE_ENV] = "/tmp/override-log.jsonl";
    expect(resolveHooksStatusFile(root)).toBe("/tmp/override-status.json");
    expect(resolveHooksLogFile(root)).toBe("/tmp/override-log.jsonl");
    if (prevStatus === undefined) delete process.env[STATUS_FILE_ENV];
    else process.env[STATUS_FILE_ENV] = prevStatus;
    if (prevLog === undefined) delete process.env[LOG_FILE_ENV];
    else process.env[LOG_FILE_ENV] = prevLog;

    const statusFile = path.join(root, "status.json");
    const logFile = path.join(root, "logs.jsonl");
    expect(readHookStatusSnapshot(statusFile)).toEqual({ kind: "missing" });
    expect(readHookLogRecords(logFile)).toEqual({ kind: "missing" });

    fs.writeFileSync(statusFile, "{bad");
    fs.writeFileSync(logFile, "{bad\n");
    expect(readHookStatusSnapshot(statusFile)).toEqual({ kind: "invalid" });
    expect(readHookLogRecords(logFile)).toEqual({ kind: "ok", records: [], truncated: false });

    const symStatus = path.join(root, "sym-status.json");
    fs.symlinkSync(statusFile, symStatus);
    expect(readHookStatusSnapshot(symStatus)).toEqual({ kind: "invalid" });
    expect(readHookLogRecords(symStatus)).toEqual({ kind: "invalid" });
  });

  test("git-hooks execution: exit 0 succeeds, non-zero fails closed & aborts session, truncates large output, rotates logs, and supports timeout", async () => {
    const root = makeTempDir();
    const hooksDir = path.join(root, ".owflow", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });

    const statusFile = path.join(root, "status.json");
    const logFile = path.join(root, "logs.jsonl");

    // 1. Successful hook with large stdout (> 16KB) and stderr
    fs.writeFileSync(
      path.join(hooksDir, "tool-execute-before.sh"),
      `#!/usr/bin/env bash\nhead -c ${MAX_CAPTURE_BYTES + 100} < /dev/zero | tr '\\0' 'a'\necho "warn line" >&2\nexit 0\n`,
    );
    // 2. Failing hook (non-zero exit)
    fs.writeFileSync(
      path.join(hooksDir, "chat-message.sh"),
      `#!/usr/bin/env bash\necho "policy violation" >&2\nexit 2\n`,
    );

    const ended: string[] = [];
    const wrapper = await initializeHooksWrapper(
      root,
      (id) => {
        ended.push(id);
      },
      { statusFile, logFile },
    );

    await wrapper.dispatch(HookEvent.ToolExecuteBefore, { sessionID: "ses_ok" }, {});
    const latestOk = readLatestHookLog(logFile, HookEvent.ToolExecuteBefore);
    expect(latestOk?.status).toBe("success");
    expect(latestOk?.truncated).toBe(true);
    expect(latestOk?.stderr).toBe("warn line\n");
    expect(readLatestHookLog(logFile, HookEvent.ToolExecuteBefore, Date.now() + 10_000)).toBeUndefined();

    // Coalescing identical consecutive run does not duplicate JSONL line
    await wrapper.dispatch(HookEvent.ToolExecuteBefore, { sessionID: "ses_ok" }, {});
    const logsAfterRepeat = readHookLogRecords(logFile);
    expect(logsAfterRepeat.kind === "ok" && logsAfterRepeat.records.length).toBe(1);

    // Non-zero exit fails closed and ends session
    await expect(
      wrapper.dispatch(HookEvent.ChatMessage, { sessionID: "ses_fail" }, {}),
    ).rejects.toThrow(/Blocked: policy violation\./);
    expect(ended).toEqual(["ses_fail"]);

    // Log rotation when file > MAX_LOG_FILE_BYTES
    fs.writeFileSync(logFile, "x".repeat(MAX_LOG_FILE_BYTES + 10));
    await wrapper.dispatch(HookEvent.ToolExecuteBefore, { sessionID: "ses_rotated" }, {});
    expect(fs.existsSync(`${logFile}.1`)).toBe(true);

    wrapper.dispose();
  });

  test("timeout and missing interpreter fail closed", async () => {
    const root = makeTempDir();
    const hooksDir = path.join(root, ".owflow", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, "config.sh"), "#!/usr/bin/env bash\ncat >/dev/null\nexec sleep 5\n");

    const prevTimeout = process.env[HOOK_TIMEOUT_ENV];
    process.env[HOOK_TIMEOUT_ENV] = "30";
    try {
      const wrapper = await initializeHooksWrapper(root, undefined, {
        statusFile: path.join(root, "s.json"),
        logFile: path.join(root, "l.jsonl"),
      });
      await expect(wrapper.dispatch(HookEvent.Config, {})).rejects.toThrow(/timed out after 30ms/);
      wrapper.dispose();
    } finally {
      if (prevTimeout === undefined) delete process.env[HOOK_TIMEOUT_ENV];
      else process.env[HOOK_TIMEOUT_ENV] = prevTimeout;
    }

    // Missing interpreter branch
    const whichSpy = spyOn(Bun, "which").mockReturnValue(null);
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const wrapper = await initializeHooksWrapper(
        root,
        () => {
          throw new Error("abort failed");
        },
        {
          statusFile: path.join(root, "s2.json"),
          logFile: path.join(root, "l2.jsonl"),
        },
      );
      await expect(
        wrapper.dispatch(HookEvent.Config, { sessionID: "ses_no_interp" }),
      ).rejects.toThrow(/bash interpreter is not available/);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      whichSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  test("createDispatchHandlers fans out host events and serializes concurrent runs", async () => {
    const events: string[] = [];
    const handlers = createDispatchHandlers(async (event) => {
      events.push(event);
    });
    await handlers.event!({ event: { type: "session.idle" } } as any);
    expect(events).toEqual(["session.idle", "event"]);
  });
});
