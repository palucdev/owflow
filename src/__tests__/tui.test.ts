import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import tuiModule, {
  buildActiveHooksView,
  buildHookLogsBody,
  colorForStatus,
  formatHookLogsMessage,
  formatHookRunSummary,
  formatSessionHookLogsMessage,
  registerActiveHooksSidebar,
  statusLabelFor,
  type SidebarTheme,
} from "../tui.js";
import type { HookRunLogRecord } from "../hooks/user-hooks.js";

interface FakeNode {
  tag: string;
  props: Record<string, any>;
  children: (FakeNode | string)[];
}

const THEME: SidebarTheme = {
  text: "text-color",
  textMuted: "muted-color",
  primary: "primary-color",
  selectedListItemText: "selected-text-color",
  backgroundElement: "bg-element-color",
  warning: "warning-color",
  success: "success-color",
  error: "error-color",
};

const makeSolid = () => {
  const roots: FakeNode[] = [];
  const runtime = {
    createElement: (tag: string): FakeNode => {
      const node: FakeNode = { tag, props: {}, children: [] };
      if (tag === "box") roots.push(node);
      return node;
    },
    insert: (parent: any, child: any) => {
      parent.children.push(child);
    },
    setProp: (node: any, name: string, value: any) => {
      node.props[name] = value;
    },
  };
  return { runtime, roots };
};

const makeFakeApi = (directory: string) => {
  const slots: any[] = [];
  const dialogCalls: Array<{ render: () => any; onClose?: () => void }> = [];
  const toasts: any[] = [];
  const disposeCallbacks: (() => void)[] = [];
  let renders = 0;

  const api: any = {
    slots: {
      register: (registration: any) => {
        slots.push(registration);
        return "owflow:0";
      },
    },
    theme: { current: THEME },
    state: { path: { directory } },
    renderer: {
      width: 120,
      height: 40,
      requestRender: () => {
        renders += 1;
      },
    },
    lifecycle: {
      onDispose: (callback: () => void) => {
        disposeCallbacks.push(callback);
        return () => {};
      },
    },
    ui: {
      Dialog: (props: any) => props,
      dialog: {
        replace: (render: () => any, onClose?: () => void) => {
          dialogCalls.push({ render, onClose });
        },
        setSize: () => {},
        clear: () => {},
      },
      toast: (input: any) => {
        toasts.push(input);
      },
    },
  };

  return {
    api,
    slots,
    dialogCalls,
    toasts,
    disposeCallbacks,
    getRenders: () => renders,
  };
};

const collectText = (node: FakeNode | string): string => {
  if (typeof node === "string") return node;
  const content =
    typeof node.props.content === "string" ? node.props.content : "";
  return [content, ...node.children.map(collectText)]
    .filter(Boolean)
    .join("\n");
};

const findClickableByContent = (
  node: FakeNode,
  text: string,
): FakeNode | undefined => {
  if (
    typeof node.props.onMouseUp === "function" &&
    collectText(node).includes(text)
  ) {
    return node;
  }
  for (const child of node.children) {
    if (typeof child === "object") {
      const found = findClickableByContent(child, text);
      if (found) return found;
    }
  }
  return undefined;
};

const makeLogRecord = (
  overrides: Partial<HookRunLogRecord> = {},
): HookRunLogRecord => ({
  version: 1,
  runId: "tool.execute.before#1",
  pid: 1,
  workspace: "/project",
  event: "tool.execute.before",
  hook: "/project/.owflow/hooks/tool-execute-before.sh",
  name: "tool-execute-before",
  startedAt: 1_000,
  finishedAt: 1_123,
  durationMs: 123,
  status: "success",
  ...overrides,
});

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe("TUI module", () => {
  let tmpDir: string;
  let hooksDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "owflow-tui-test-"));
    hooksDir = path.join(tmpDir, ".owflow", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
  });

  afterEach(() => {
    mock.restore();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("should export default tui plugin module metadata", () => {
    expect(tuiModule.id).toBe("owflow");
    expect(typeof tuiModule.tui).toBe("function");
    expect("server" in tuiModule).toBe(false);
  });

  describe("pure formatting helpers", () => {
    test("buildActiveHooksView should return active hook rows from hooks directory", () => {
      fs.writeFileSync(path.join(hooksDir, "tool-execute-before.sh"), "");
      fs.writeFileSync(path.join(hooksDir, "config.sh"), "");

      const view = buildActiveHooksView(tmpDir);
      expect(view.title).toBe("Active hooks:");
      expect(view.rows).toEqual([
        { name: "config", event: "config" },
        { name: "tool-execute-before", event: "tool.execute.before" },
      ]);
    });

    test("statusLabelFor and colorForStatus should map states to labels and theme colors", () => {
      expect(statusLabelFor("pending")).toBe("In progress");
      expect(statusLabelFor("success")).toBe("Success");
      expect(statusLabelFor("failure")).toBe("Error");
      expect(statusLabelFor(undefined)).toBe("Idle");

      expect(colorForStatus("pending", THEME)).toBe("warning-color");
      expect(colorForStatus("success", THEME)).toBe("success-color");
      expect(colorForStatus("failure", THEME)).toBe("error-color");
      expect(colorForStatus(undefined, THEME)).toBe("muted-color");
    });

    test("formatHookRunSummary should format run metadata and support truncation", () => {
      const record = makeLogRecord({
        status: "failure",
        exitCode: 1,
        reason: "policy violation",
        sessionID: "ses-123",
      });
      const summary = formatHookRunSummary(record);
      expect(summary).toContain("Event:  tool.execute.before");
      expect(summary).toContain("Error — 123 ms");
      expect(summary).toContain("Session: ses-123");
      expect(summary).toContain("Exit:   1");
      expect(summary).toContain("Reason: policy violation");

      const truncated = formatHookRunSummary(record, 40);
      expect(truncated).toContain("[message truncated]");
      expect(truncated.length).toBeLessThanOrEqual(40);
    });

    test("formatHookLogsMessage and formatSessionHookLogsMessage should format outputs", () => {
      // Empty output
      expect(formatHookLogsMessage(makeLogRecord())).toBe(
        "No output captured for this run.",
      );

      // Captured stdout & stderr
      const record = makeLogRecord({ stdout: "out-line", stderr: "err-line" });
      const message = formatHookLogsMessage(record);
      expect(message).toContain("--- stdout ---\nout-line");
      expect(message).toContain("--- stderr ---\nerr-line");

      // Multiple session records
      const record2 = makeLogRecord({
        status: "failure",
        stderr: "second-err",
      });
      const sessionMsg = formatSessionHookLogsMessage([record, record2]);
      expect(sessionMsg).toContain("=== Run #1");
      expect(sessionMsg).toContain("=== Run #2");
      expect(sessionMsg).toContain("second-err");
    });
  });

  describe("sidebar registration and rendering", () => {
    test("should register sidebar slot and render active hooks or (none) when empty", async () => {
      const { api, slots } = makeFakeApi(tmpDir);
      const { runtime } = makeSolid();

      // Empty hooks directory
      await registerActiveHooksSidebar(api, tmpDir, async () => runtime, {
        pollMs: 50,
      });
      expect(slots).toHaveLength(1);
      expect(slots[0].order).toBe(50);

      const emptyRender = slots[0].slots.sidebar_content({
        theme: { current: THEME },
      });
      expect(collectText(emptyRender)).toContain("(none)");

      // With hooks registered and session_id
      fs.writeFileSync(path.join(hooksDir, "tool-execute-before.sh"), "");
      const { api: apiWithHooks, slots: slotsWithHooks } = makeFakeApi(tmpDir);
      await registerActiveHooksSidebar(
        apiWithHooks,
        tmpDir,
        async () => runtime,
        { pollMs: 50 },
      );

      const hookRender = slotsWithHooks[0].slots.sidebar_content(
        { theme: { current: THEME } },
        { session_id: "ses-test" },
      );
      const text = collectText(hookRender);
      expect(text).toContain("Active hooks:");
      expect(text).toContain("tool-execute-before");
      expect(text).toContain("Idle");
    });

    test("should warn and exit gracefully when directory is empty or solid runtime is unavailable", async () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

      try {
        // Missing directory
        const { api: emptyDirApi, slots } = makeFakeApi("");
        await tuiModule.tui(emptyDirApi);
        expect(slots).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("workspace directory unavailable"),
        );

        // Solid runtime returns null
        const { api: validApi } = makeFakeApi(tmpDir);
        const result = await registerActiveHooksSidebar(
          validApi,
          tmpDir,
          async () => null,
        );
        expect(result).toBe(false);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("TUI Solid runtime unavailable"),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    test("should register sidebar via tuiModule.tui with valid directory and imported runtime", async () => {
      const { api, slots } = makeFakeApi(tmpDir);
      const { runtime } = makeSolid();
      mock.module("@opentui/solid", () => runtime);

      await tuiModule.tui(api);
      expect(slots).toHaveLength(1);
      expect(slots[0].order).toBe(50);
    });
  });

  describe("interaction and dialogs", () => {
    test("should open detail popup and navigate to logs when runs exist", async () => {
      fs.writeFileSync(path.join(hooksDir, "tool-execute-before.sh"), "");
      const logFile = path.join(tmpDir, "hook-logs.jsonl");
      const record = makeLogRecord({ stdout: "my log content" });
      fs.writeFileSync(logFile, `${JSON.stringify(record)}\n`, "utf8");

      const { api, slots, dialogCalls } = makeFakeApi(tmpDir);
      const { runtime } = makeSolid();

      await registerActiveHooksSidebar(api, tmpDir, async () => runtime, {
        statusFile: path.join(tmpDir, "status.json"),
        logFile,
        pollMs: 50,
        now: () => 0,
      });

      const rendered = slots[0].slots.sidebar_content({
        theme: { current: THEME },
      });
      const hookRow = findClickableByContent(rendered, "tool-execute-before");
      expect(hookRow).toBeDefined();

      // Click hook row opens detail dialog
      hookRow!.props.onMouseOver?.();
      hookRow!.props.onMouseOut?.();
      (hookRow!.props.onMouseUp as () => void)();
      expect(dialogCalls).toHaveLength(1);

      const detail = dialogCalls[0]!.render();
      const detailText = collectText(detail);
      expect(detailText).toContain("Hook run: tool-execute-before");
      expect(detailText).toContain("View logs");

      // Click "View logs" opens logs dialog
      const viewLogsButton = findClickableByContent(detail, "View logs");
      expect(viewLogsButton).toBeDefined();
      viewLogsButton!.props.onMouseOver?.();
      viewLogsButton!.props.onMouseOut?.();
      (viewLogsButton!.props.onMouseUp as () => void)();

      expect(dialogCalls).toHaveLength(2);
      const logsView = dialogCalls[1]!.render();
      expect(collectText(logsView)).toContain("my log content");

      // Close dialog via esc button
      const escButton = findClickableByContent(logsView, "esc");
      escButton?.props.onMouseUp?.();
    });

    test("should show toast when clicked hook has no recorded runs", async () => {
      fs.writeFileSync(path.join(hooksDir, "tool-execute-before.sh"), "");
      const { api, slots, dialogCalls, toasts } = makeFakeApi(tmpDir);
      const { runtime } = makeSolid();

      await registerActiveHooksSidebar(api, tmpDir, async () => runtime, {
        statusFile: path.join(tmpDir, "status.json"),
        logFile: path.join(tmpDir, "empty-logs.jsonl"),
        pollMs: 50,
      });

      const rendered = slots[0].slots.sidebar_content({
        theme: { current: THEME },
      });
      const hookRow = findClickableByContent(rendered, "tool-execute-before");
      (hookRow!.props.onMouseUp as () => void)();

      expect(dialogCalls).toHaveLength(0);
      expect(toasts).toHaveLength(1);
      expect(toasts[0].message).toContain(
        "No runs recorded for tool-execute-before",
      );
    });
  });

  describe("status polling and lifecycle", () => {
    test("should update status from status file and clean up on dispose", async () => {
      fs.writeFileSync(path.join(hooksDir, "tool-execute-before.sh"), "");
      const statusFile = path.join(tmpDir, "status.json");
      const { api, slots, disposeCallbacks, getRenders } = makeFakeApi(tmpDir);
      const { runtime } = makeSolid();

      await registerActiveHooksSidebar(api, tmpDir, async () => runtime, {
        statusFile,
        pollMs: 10,
      });

      const rendered = slots[0].slots.sidebar_content({
        theme: { current: THEME },
      });
      expect(collectText(rendered)).toContain("Idle");

      // Update status file to pending
      const now = Date.now();
      fs.writeFileSync(
        statusFile,
        JSON.stringify({
          version: 1,
          pid: 1,
          workspace: tmpDir,
          updatedAt: now,
          hooks: {
            "tool.execute.before": { status: "pending", startedAt: now },
          },
        }),
      );
      await wait(30);

      expect(collectText(rendered)).toContain("In progress");
      expect(getRenders()).toBeGreaterThan(0);

      // Clean up on dispose stops polling
      for (const cb of disposeCallbacks) cb();
      const rendersBefore = getRenders();

      fs.writeFileSync(
        statusFile,
        JSON.stringify({
          version: 1,
          pid: 1,
          workspace: tmpDir,
          updatedAt: Date.now(),
          hooks: {
            "tool.execute.before": {
              status: "success",
              startedAt: now,
              finishedAt: Date.now(),
            },
          },
        }),
      );
      await wait(30);

      expect(getRenders()).toBe(rendersBefore);
    });

    test("should disable polling and interactions when OWFLOW_HOOKS_DISABLED=1", async () => {
      const prev = process.env.OWFLOW_HOOKS_DISABLED;
      process.env.OWFLOW_HOOKS_DISABLED = "1";

      try {
        fs.writeFileSync(path.join(hooksDir, "tool-execute-before.sh"), "");
        const { api, slots } = makeFakeApi(tmpDir);
        const { runtime } = makeSolid();

        await registerActiveHooksSidebar(api, tmpDir, async () => runtime, {
          statusFile: path.join(tmpDir, "status.json"),
          pollMs: 10,
        });

        const rendered = slots[0].slots.sidebar_content({
          theme: { current: THEME },
        });
        const hookRow = findClickableByContent(rendered, "tool-execute-before");
        expect(hookRow).toBeUndefined(); // Non-interactive
      } finally {
        if (prev === undefined) delete process.env.OWFLOW_HOOKS_DISABLED;
        else process.env.OWFLOW_HOOKS_DISABLED = prev;
      }
    });
  });

  describe("buildHookLogsBody lazy loading", () => {
    test("should lazy-load large logs in chunks on scroll", () => {
      const { runtime } = makeSolid();
      const lines = Array.from({ length: 150 }, (_, i) => `log line ${i + 1}`);
      const record = makeLogRecord({ stdout: lines.join("\n") });
      let rendered = false;

      const body = buildHookLogsBody(
        record,
        THEME,
        runtime,
        () => {},
        20,
        {
          requestRender: () => {
            rendered = true;
          },
        },
        50,
      ) as FakeNode;

      const scrollbox = body.children.find(
        (c): c is FakeNode => typeof c === "object" && c.tag === "scrollbox",
      );
      expect(scrollbox).toBeDefined();

      // Initial chunk (50 lines loaded)
      let text = collectText(scrollbox!);
      expect(text).toContain("log line 1");
      expect(text).toContain("log line 49");
      expect(text).not.toContain("log line 50");
      expect(text).toContain("[scroll for more logs: 50/151 lines loaded]");

      // Scroll to trigger loadMore
      expect(typeof scrollbox!.props.onScroll).toBe("function");
      scrollbox!.props.onScroll();

      // 100 lines loaded
      text = collectText(scrollbox!);
      expect(text).toContain("log line 50");
      expect(text).toContain("log line 99");
      expect(rendered).toBe(true);

      // Load all
      scrollbox!.props.loadAll();
      text = collectText(scrollbox!);
      expect(text).toContain("log line 150");
      expect(text).not.toContain("[scroll for more logs");
    });
  });
});
