import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import tuiModule, {
  buildActiveHooksView,
  colorForStatus,
  effectiveStatuses,
  formatHookLogsMessage,
  formatHookRunSummary,
  registerActiveHooksSidebar,
  statusForDisplay,
  statusLabelFor,
} from "../tui.js";
import type { SidebarTheme } from "../tui.js";
import {
  HookDigestMode,
  scanHooks,
  type HookRunLogRecord,
  type HookRunState,
} from "../hooks/user-hooks.js";

interface FakeNode {
  readonly tag: string;
  readonly props: Record<string, unknown>;
  readonly children: (FakeNode | string)[];
  isDestroyed?: boolean;
}

interface FakeSlotRegistration {
  readonly order?: number;
  readonly slots: Record<string, (ctx: unknown, props: unknown) => unknown>;
}

interface FakeDialogProps {
  readonly size?: string;
  readonly onClose?: () => void;
  readonly children?: FakeNode;
}

interface FakeDialogCall {
  readonly render: () => unknown;
  readonly onClose?: () => void;
}

interface FakeToast {
  readonly variant?: string;
  readonly title?: string;
  readonly message: string;
}

interface FakeApi {
  readonly api: TuiPluginApi;
  readonly slots: FakeSlotRegistration[];
  readonly accessed: string[];
  readonly disposeCallbacks: (() => void)[];
  readonly requestRenderCalls: () => number;
  readonly dialogCalls: FakeDialogCall[];
  readonly dialogSizes: string[];
  readonly toasts: FakeToast[];
  readonly dialogClears: () => number;
}

const tempDirs: string[] = [];
let mtime = Date.now() + 60_000;

const makeWorkspace = (): { root: string; hooksDir: string } => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owflow-tui-test-"));
  tempDirs.push(root);
  const hooksDir = path.join(root, ".owflow", "hooks");
  fs.mkdirSync(hooksDir, { recursive: true });
  return { root, hooksDir };
};

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

const slotContext = () => ({
  theme: {
    current: THEME,
  },
});

const makeFakeApi = (directory: string): FakeApi => {
  const slots: FakeSlotRegistration[] = [];
  const accessed: string[] = [];
  const disposeCallbacks: (() => void)[] = [];
  const dialogCalls: FakeDialogCall[] = [];
  const dialogSizes: string[] = [];
  const toasts: FakeToast[] = [];
  let dialogClears = 0;
  let renders = 0;
  const base = {
    slots: {
      register: (registration: FakeSlotRegistration): string => {
        slots.push(registration);
        return "owflow:0";
      },
    },
    theme: {
      current: THEME,
    },
    state: { path: { directory } },
    renderer: {
      width: 120,
      height: 40,
      requestRender: (): void => {
        renders += 1;
      },
    },
    lifecycle: {
      signal: new AbortController().signal,
      onDispose: (callback: () => void): (() => void) => {
        disposeCallbacks.push(callback);
        return () => {};
      },
    },
    ui: {
      Dialog: (props: FakeDialogProps): FakeDialogProps => props,
      dialog: {
        replace: (render: () => unknown, onClose?: () => void): void => {
          dialogCalls.push({ render, onClose });
        },
        setSize: (size: string): void => {
          dialogSizes.push(size);
        },
        clear: (): void => {
          dialogClears += 1;
        },
      },
      toast: (input: FakeToast): void => {
        toasts.push(input);
      },
    },
    client: new Proxy(
      {},
      {
        get(): never {
          throw new Error("api.client was accessed");
        },
      },
    ),
  };
  const api = new Proxy(base, {
    get(target, property, receiver) {
      accessed.push(String(property));
      return Reflect.get(target, property, receiver);
    },
  }) as unknown as TuiPluginApi;
  return {
    api,
    slots,
    accessed,
    disposeCallbacks,
    requestRenderCalls: () => renders,
    dialogCalls,
    dialogSizes,
    toasts,
    dialogClears: () => dialogClears,
  };
};

const makeSolid = (): {
  readonly runtime: {
    createElement: (tag: string) => FakeNode;
    insert: (parent: unknown, child: unknown) => void;
    setProp: (node: unknown, name: string, value: unknown) => void;
  };
  readonly roots: FakeNode[];
} => {
  const roots: FakeNode[] = [];
  return {
    roots,
    runtime: {
      createElement: (tag: string): FakeNode => {
        const node: FakeNode = { tag, props: {}, children: [] };
        if (tag === "box") roots.push(node);
        return node;
      },
      insert: (parent: unknown, child: unknown): void => {
        (parent as FakeNode).children.push(child as FakeNode | string);
      },
      setProp: (node: unknown, name: string, value: unknown): void => {
        (node as FakeNode).props[name] = value;
      },
    },
  };
};

const writeStatusSnapshot = (
  file: string,
  hooks: Record<string, HookRunState>,
  timestamp = Date.now(),
): void => {
  const entries = Object.fromEntries(
    Object.entries(hooks).map(([event, status]) => [
      event,
      {
        status,
        startedAt: timestamp,
        ...(status === "pending" ? {} : { finishedAt: timestamp }),
      },
    ]),
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      pid: 1,
      workspace: path.dirname(file),
      updatedAt: timestamp,
      hooks: entries,
    }),
    "utf8",
  );
  mtime += 1_000;
  const stamp = new Date(mtime);
  fs.utimesSync(file, stamp, stamp);
};

const logRecord = (
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

const writeLogRecord = (
  file: string,
  overrides: Partial<HookRunLogRecord> = {},
): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(logRecord(overrides))}\n`, "utf8");
};

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const nodeText = (node: FakeNode): string =>
  typeof node.props.content === "string"
    ? node.props.content
    : typeof node.children[0] === "string"
      ? node.children[0]
      : "";

const collectText = (node: FakeNode | string): string => {
  if (typeof node === "string") return node;
  return [nodeText(node), ...node.children.map(collectText)]
    .filter((part) => part.length > 0)
    .join("\n");
};

const findByContent = (
  node: FakeNode,
  content: string,
): FakeNode | undefined => {
  if (node.props.content === content) return node;
  for (const child of node.children) {
    if (typeof child === "string") continue;
    const found = findByContent(child, content);
    if (found !== undefined) return found;
  }
  return undefined;
};

const findClickableByContent = (
  node: FakeNode,
  content: string,
): FakeNode | undefined => {
  for (const child of node.children) {
    if (typeof child === "string") continue;
    if (
      typeof child.props.onMouseUp === "function" &&
      collectText(child).includes(content)
    ) {
      return child;
    }
    const found = findClickableByContent(child, content);
    if (found !== undefined) return found;
  }
  return undefined;
};

const row = (rendered: FakeNode, name: string): FakeNode => {
  const found = rendered.children
    .slice(1)
    .find(
      (child): child is FakeNode =>
        typeof child === "object" &&
        child.tag === "box" &&
        child.children.some(
          (item) => typeof item === "object" && nodeText(item) === name,
        ),
    );
  if (found === undefined) throw new Error(`row not found: ${name}`);
  return found;
};

const orbOf = (rendered: FakeNode, name: string): FakeNode =>
  row(rendered, name).children[0] as FakeNode;

const statusOf = (rendered: FakeNode, name: string): FakeNode =>
  row(rendered, name).children[2] as FakeNode;

const clickRow = (rendered: FakeNode, name: string): void => {
  const handler = row(rendered, name).props.onMouseUp;
  if (typeof handler !== "function") {
    throw new Error(`row has no click handler: ${name}`);
  }
  (handler as () => void)();
};

describe("owflow TUI plugin", () => {
  afterEach(() => {
    mock.restore();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("should default-export a tui-only module: id owflow, a tui function, and no server key", () => {
    expect(tuiModule.id).toBe("owflow");
    expect(typeof tuiModule.tui).toBe("function");
    expect("server" in tuiModule).toBe(false);
  });

  test("should list loaded hooks with their events in registry order", () => {
    const { root, hooksDir } = makeWorkspace();
    fs.writeFileSync(path.join(hooksDir, "tool-execute-before.sh"), "");
    fs.writeFileSync(path.join(hooksDir, "config.sh"), "");
    fs.writeFileSync(path.join(hooksDir, "session-idle.sh"), "");

    const scan = scanHooks(hooksDir, { mode: HookDigestMode.Report });
    expect(scan.entries.map((entry) => entry.event)).toEqual([
      "config",
      "session.idle",
      "tool.execute.before",
    ]);
    expect(buildActiveHooksView(root)).toEqual({
      title: "Active hooks:",
      rows: [
        { name: "config", event: "config" },
        { name: "session-idle", event: "session.idle" },
        { name: "tool-execute-before", event: "tool.execute.before" },
      ],
    });
  });

  test("should map pending, success, failure, and idle to the shared theme", () => {
    expect(colorForStatus("pending", THEME)).toBe("warning-color");
    expect(colorForStatus("success", THEME)).toBe("success-color");
    expect(colorForStatus("failure", THEME)).toBe("error-color");
    expect(colorForStatus(undefined, THEME)).toBe("muted-color");
    expect(statusLabelFor("pending")).toBe("In progress");
    expect(statusLabelFor("success")).toBe("Success");
    expect(statusLabelFor("failure")).toBe("Error");
    expect(statusLabelFor(undefined)).toBe("Idle");
  });

  test("should keep the last outcome visible until the hook runs again", () => {
    const settled = {
      status: "success" as const,
      startedAt: 1_000,
      finishedAt: 1_100,
    };
    expect(statusForDisplay(undefined)).toBeUndefined();
    expect(statusForDisplay(settled)).toBe("success");
    expect(
      statusForDisplay({ status: "failure", startedAt: 1_000, finishedAt: 1_100 }),
    ).toBe("failure");
    expect(statusForDisplay({ status: "pending", startedAt: 1_000 })).toBe(
      "pending",
    );

    const entries = new Map([
      ["tool.execute.before", settled],
      ["event", { status: "pending" as const, startedAt: 1_000 }],
    ]);
    expect(effectiveStatuses(entries)).toEqual(
      new Map([
        ["tool.execute.before", "success"],
        ["event", "pending"],
      ]),
    );
  });

  test("should ignore runs that started before the panel's session epoch", () => {
    const settled = {
      status: "success" as const,
      startedAt: 1_000,
      finishedAt: 1_100,
    };
    expect(statusForDisplay(settled, 2_000)).toBeUndefined();
    expect(statusForDisplay(settled, 1_000)).toBe("success");
    expect(
      statusForDisplay({ status: "pending", startedAt: 1_000 }, 2_000),
    ).toBeUndefined();

    const entries = new Map([["event", settled]]);
    expect(effectiveStatuses(entries, 2_000)).toEqual(new Map());
    expect(effectiveStatuses(entries, 1_000)).toEqual(
      new Map([["event", "success"]]),
    );
  });

  test("should render an always-on right sidebar panel with one line per hook", async () => {
    const { root, hooksDir } = makeWorkspace();
    fs.writeFileSync(path.join(hooksDir, "tool-execute-before.sh"), "");
    const { api, slots } = makeFakeApi(root);
    const { runtime, roots } = makeSolid();
    const statusFile = path.join(root, "status.json");

    const registered = await registerActiveHooksSidebar(
      api,
      root,
      async () => runtime,
      { statusFile, pollMs: 5 },
    );

    expect(registered).toBe(true);
    expect(slots).toHaveLength(1);
    expect(slots[0]!.order).toBe(50);
    expect(Object.keys(slots[0]!.slots)).toEqual(["sidebar_content"]);

    const rendered = slots[0]!.slots.sidebar_content!(
      slotContext(),
      {},
    ) as FakeNode;
    expect(rendered).toBe(roots[0]!);
    expect(rendered.tag).toBe("box");
    expect(rendered.props.flexDirection).toBe("column");
    expect(rendered.children).toHaveLength(2);

    const [title, hook] = rendered.children as FakeNode[];
    expect(title!.tag).toBe("text");
    expect(title!.children).toEqual(["Active hooks:"]);
    expect(title!.props.fg).toBe("text-color");
    expect(hook!.tag).toBe("box");
    expect(hook!.props.flexDirection).toBe("row");
    expect(hook!.props.gap).toBe(1);

    const [orb, name, state, hint] = hook!.children as FakeNode[];
    expect(orb!.props.content).toBe("•");
    expect(orb!.props.fg).toBe("muted-color");
    expect(name!.props.content).toBe("tool-execute-before");
    expect(name!.props.fg).toBe("text-color");
    expect(state!.props.content).toBe("Idle");
    expect(state!.props.fg).toBe("muted-color");
    expect(hint!.props.content).toBe("›");
    expect(hint!.props.fg).toBe("muted-color");
  });

  test("should hint clickability with a hover highlight and an open indicator", async () => {
    const { root, hooksDir } = makeWorkspace();
    fs.writeFileSync(path.join(hooksDir, "tool-execute-before.sh"), "");
    const { api, slots } = makeFakeApi(root);
    const { runtime } = makeSolid();

    await registerActiveHooksSidebar(api, root, async () => runtime, {
      statusFile: path.join(root, "status.json"),
      pollMs: 5,
    });
    const rendered = slots[0]!.slots.sidebar_content!(
      slotContext(),
      {},
    ) as FakeNode;

    const hookRow = row(rendered, "tool-execute-before");
    const [, name, , hint] = hookRow.children as FakeNode[];
    expect(typeof hookRow.props.onMouseOver).toBe("function");
    expect(typeof hookRow.props.onMouseOut).toBe("function");

    (hookRow.props.onMouseOver as () => void)();
    expect(hookRow.props.backgroundColor).toBe("bg-element-color");
    expect(name!.props.fg).toBe("primary-color");
    expect(hint!.props.fg).toBe("primary-color");

    (hookRow.props.onMouseOut as () => void)();
    expect(hookRow.props.backgroundColor).toBeUndefined();
    expect(name!.props.fg).toBe("text-color");
    expect(hint!.props.fg).toBe("muted-color");
  });

  test("should open the popup on mouse-up so the opening click does not dismiss it", async () => {
    const { root, hooksDir } = makeWorkspace();
    fs.writeFileSync(path.join(hooksDir, "tool-execute-before.sh"), "");
    const logFile = path.join(root, "hook-logs.jsonl");
    writeLogRecord(logFile);
    const { api, slots, dialogCalls } = makeFakeApi(root);
    const { runtime } = makeSolid();

    await registerActiveHooksSidebar(api, root, async () => runtime, {
      statusFile: path.join(root, "status.json"),
      logFile,
      pollMs: 5,
      now: () => 0,
    });
    const rendered = slots[0]!.slots.sidebar_content!(
      slotContext(),
      {},
    ) as FakeNode;

    const hookRow = row(rendered, "tool-execute-before");
    expect(hookRow.props.onMouseDown).toBeUndefined();
    expect(typeof hookRow.props.onMouseUp).toBe("function");

    clickRow(rendered, "tool-execute-before");
    expect(dialogCalls).toHaveLength(1);
  });

  test("should open a centered run-detail popup with a logs button, then the logs popup", async () => {
    const { root, hooksDir } = makeWorkspace();
    fs.writeFileSync(path.join(hooksDir, "tool-execute-before.sh"), "");
    const statusFile = path.join(root, "status.json");
    const logFile = path.join(root, "hook-logs.jsonl");
    writeLogRecord(logFile, {
      status: "failure",
      reason: "policy says no",
      exitCode: 2,
      stderr: "captured stderr\n",
    });
    const { api, slots, dialogCalls, dialogSizes, toasts, dialogClears } =
      makeFakeApi(root);
    const { runtime } = makeSolid();

    await registerActiveHooksSidebar(api, root, async () => runtime, {
      statusFile,
      logFile,
      pollMs: 5,
      now: () => 0,
    });
    const rendered = slots[0]!.slots.sidebar_content!(
      slotContext(),
      {},
    ) as FakeNode;
    clickRow(rendered, "tool-execute-before");

    expect(dialogCalls).toHaveLength(1);
    expect(toasts).toHaveLength(0);
    expect(dialogSizes).toEqual(["large"]);
    const detail = dialogCalls[0]!.render() as FakeNode;
    expect(detail.tag).toBe("box");
    expect(detail.props.alignItems).toBe("center");
    expect(detail.props.width).toBe("100%");
    const detailText = collectText(detail);
    expect(detailText).toContain("Hook run: tool-execute-before");
    expect(detailText).toContain("Event:  tool.execute.before");
    expect(detailText).toContain("Error");
    expect(detailText).toContain("123 ms");
    expect(detailText).toContain("policy says no");
    expect(detailText).toContain("Exit:   2");
    expect(detailText).toContain(`Log file: ${logFile}`);
    expect(detailText).not.toContain("captured stderr");

    const button = findClickableByContent(detail, "View logs");
    expect(button).toBeDefined();
    expect(button!.props.backgroundColor).toBe("primary-color");
    const label = findByContent(button!, "View logs");
    expect(label!.props.fg).toBe("selected-text-color");

    (button!.props.onMouseOver as () => void)();
    expect(button!.props.backgroundColor).toBe("bg-element-color");
    expect(label!.props.fg).toBe("primary-color");
    (button!.props.onMouseOut as () => void)();
    expect(button!.props.backgroundColor).toBe("primary-color");
    expect(label!.props.fg).toBe("selected-text-color");

    (button!.props.onMouseUp as () => void)();

    expect(dialogCalls).toHaveLength(2);
    expect(dialogSizes).toEqual(["large", "large"]);
    const logs = dialogCalls[1]!.render() as FakeNode;
    expect(logs.tag).toBe("box");
    const logsText = collectText(logs);
    expect(logsText).toContain("Hook logs: tool-execute-before");
    expect(logsText).toContain("captured stderr");
    expect(logsText).not.toContain("policy says no");

    const scrollbox = logs.children.find(
      (child): child is FakeNode =>
        typeof child === "object" && child.tag === "scrollbox",
    );
    expect(scrollbox).toBeDefined();
    expect(scrollbox!.props.flexGrow).toBe(1);
    expect(scrollbox!.props.width).toBe("100%");
    expect(scrollbox!.props.maxHeight).toBe(22);
    expect(scrollbox!.props.focused).toBe(true);
    expect(collectText(scrollbox!)).toContain("--- stderr ---");
    expect(collectText(scrollbox!)).toContain("captured stderr");

    const esc = findClickableByContent(logs, "esc");
    expect(esc).toBeDefined();
    (esc!.props.onMouseUp as () => void)();
    expect(dialogClears()).toBe(1);
  });

  test("should toast when the clicked hook has no recorded runs", async () => {
    const { root, hooksDir } = makeWorkspace();
    fs.writeFileSync(path.join(hooksDir, "tool-execute-before.sh"), "");
    const { api, slots, dialogCalls, toasts } = makeFakeApi(root);
    const { runtime } = makeSolid();

    await registerActiveHooksSidebar(api, root, async () => runtime, {
      statusFile: path.join(root, "status.json"),
      logFile: path.join(root, "missing-logs.jsonl"),
      pollMs: 5,
    });
    const rendered = slots[0]!.slots.sidebar_content!(
      slotContext(),
      {},
    ) as FakeNode;
    clickRow(rendered, "tool-execute-before");

    expect(dialogCalls).toHaveLength(0);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toEqual({
      variant: "info",
      title: "Hook logs",
      message: "No runs recorded for tool-execute-before in this session yet.",
    });
  });

  test("should ignore a run recorded before the session panel opened", async () => {
    const { root, hooksDir } = makeWorkspace();
    fs.writeFileSync(path.join(hooksDir, "event.sh"), "");
    const logFile = path.join(root, "hook-logs.jsonl");
    let clock = Date.now();
    writeLogRecord(logFile, {
      event: "event",
      hook: path.join(hooksDir, "event.sh"),
      name: "event",
      startedAt: clock - 60_000,
      finishedAt: clock - 59_000,
      stdout: "[log] old session output",
    });
    const { api, slots, dialogCalls, toasts } = makeFakeApi(root);
    const { runtime } = makeSolid();

    await registerActiveHooksSidebar(api, root, async () => runtime, {
      statusFile: path.join(root, "status.json"),
      logFile,
      pollMs: 5,
      now: () => clock,
    });
    const rendered = slots[0]!.slots.sidebar_content!(
      slotContext(),
      { session_id: "ses_new" },
    ) as FakeNode;
    clickRow(rendered, "event");

    expect(dialogCalls).toHaveLength(0);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toEqual({
      variant: "info",
      title: "Hook logs",
      message: "No runs recorded for event in this session yet.",
    });

    clock += 1_000;
    writeLogRecord(logFile, {
      event: "event",
      hook: path.join(hooksDir, "event.sh"),
      name: "event",
      startedAt: clock,
      finishedAt: clock + 1_000,
      stdout: "[log] current session output",
    });
    clickRow(rendered, "event");

    expect(dialogCalls).toHaveLength(1);
    expect(collectText(dialogCalls[0]!.render() as FakeNode)).toContain(
      "Hook run: event",
    );
  });

  test("should degrade to a toast when the log file is malformed", async () => {
    const { root, hooksDir } = makeWorkspace();
    fs.writeFileSync(path.join(hooksDir, "tool-execute-before.sh"), "");
    const logFile = path.join(root, "hook-logs.jsonl");
    fs.writeFileSync(logFile, "{not jsonl", "utf8");
    const { api, slots, dialogCalls, toasts } = makeFakeApi(root);
    const { runtime } = makeSolid();

    await registerActiveHooksSidebar(api, root, async () => runtime, {
      statusFile: path.join(root, "status.json"),
      logFile,
      pollMs: 5,
    });
    const rendered = slots[0]!.slots.sidebar_content!(
      slotContext(),
      {},
    ) as FakeNode;

    expect(() => clickRow(rendered, "tool-execute-before")).not.toThrow();
    expect(dialogCalls).toHaveLength(0);
    expect(toasts).toHaveLength(1);
  });

  test("should truncate run details and explicitly budgeted logs", () => {
    const record = logRecord({
      status: "failure",
      reason: "boom ".repeat(100),
      stderr: "x".repeat(10_000),
      truncated: true,
    });

    const summary = formatHookRunSummary(record, 200);
    expect(summary.length).toBeLessThanOrEqual(200);
    expect(summary).toContain("Error");
    expect(summary).toContain("boom");
    expect(summary).not.toContain("--- stderr ---");
    expect(summary.endsWith("[message truncated]")).toBe(true);

    const logs = formatHookLogsMessage(record, 200);
    expect(logs.length).toBeLessThanOrEqual(200);
    expect(logs).toContain("--- stderr ---");
    expect(logs.endsWith("[message truncated]")).toBe(true);

    const scrollable = formatHookLogsMessage(record);
    expect(scrollable).toContain("x".repeat(10_000));
    expect(scrollable.endsWith("[message truncated]")).toBe(false);
  });

  test("should report when a run captured no output", () => {
    expect(formatHookLogsMessage(logRecord())).toBe(
      "No output captured for this run.",
    );
  });

  test("should apply pending, success, failure, and idle colors from the status snapshot", async () => {
    const { root, hooksDir } = makeWorkspace();
    for (const file of [
      "tool-execute-before.sh",
      "chat-message.sh",
      "event.sh",
      "dispose.sh",
    ]) {
      fs.writeFileSync(path.join(hooksDir, file), "");
    }
    const statusFile = path.join(root, "status.json");
    const { api, slots } = makeFakeApi(root);
    const { runtime, roots } = makeSolid();

    await registerActiveHooksSidebar(api, root, async () => runtime, {
      statusFile,
      pollMs: 5,
    });
    const rendered = slots[0]!.slots.sidebar_content!(
      slotContext(),
      {},
    ) as FakeNode;
    writeStatusSnapshot(statusFile, {
      "tool.execute.before": "pending",
      "chat.message": "success",
      event: "failure",
    });
    await wait(30);

    expect(roots[0]!.isDestroyed).toBeUndefined();
    expect(orbOf(rendered, "tool-execute-before").props.fg).toBe(
      "warning-color",
    );
    expect(statusOf(rendered, "tool-execute-before").props.content).toBe(
      "In progress",
    );
    expect(orbOf(rendered, "chat-message").props.fg).toBe("success-color");
    expect(statusOf(rendered, "chat-message").props.content).toBe("Success");
    expect(orbOf(rendered, "event").props.fg).toBe("error-color");
    expect(statusOf(rendered, "event").props.content).toBe("Error");
    expect(orbOf(rendered, "dispose").props.fg).toBe("muted-color");
    expect(statusOf(rendered, "dispose").props.content).toBe("Idle");
  });

  test("should update fg and request one render per changed batch", async () => {
    const { root, hooksDir } = makeWorkspace();
    fs.writeFileSync(path.join(hooksDir, "tool-execute-before.sh"), "");
    const statusFile = path.join(root, "status.json");
    const { api, slots, requestRenderCalls } = makeFakeApi(root);
    const { runtime } = makeSolid();

    await registerActiveHooksSidebar(api, root, async () => runtime, {
      statusFile,
      pollMs: 5,
    });
    const rendered = slots[0]!.slots.sidebar_content!(
      slotContext(),
      {},
    ) as FakeNode;
    writeStatusSnapshot(statusFile, { "tool.execute.before": "pending" });
    await wait(30);
    expect(orbOf(rendered, "tool-execute-before").props.fg).toBe(
      "warning-color",
    );
    expect(statusOf(rendered, "tool-execute-before").props.content).toBe(
      "In progress",
    );

    const before = requestRenderCalls();
    writeStatusSnapshot(statusFile, { "tool.execute.before": "success" });
    await wait(30);

    expect(orbOf(rendered, "tool-execute-before").props.fg).toBe(
      "success-color",
    );
    expect(statusOf(rendered, "tool-execute-before").props.content).toBe(
      "Success",
    );
    expect(requestRenderCalls() - before).toBe(1);
  });

  test("should keep the panel stable when the status file is missing or malformed", async () => {
    const { root, hooksDir } = makeWorkspace();
    fs.writeFileSync(path.join(hooksDir, "tool-execute-before.sh"), "");
    const statusFile = path.join(root, "status.json");
    const { api, slots, requestRenderCalls } = makeFakeApi(root);
    const { runtime } = makeSolid();

    await registerActiveHooksSidebar(api, root, async () => runtime, {
      statusFile,
      pollMs: 5,
    });
    const rendered = slots[0]!.slots.sidebar_content!(
      slotContext(),
      {},
    ) as FakeNode;
    writeStatusSnapshot(statusFile, { "tool.execute.before": "failure" });
    await wait(30);
    expect(orbOf(rendered, "tool-execute-before").props.fg).toBe("error-color");

    fs.writeFileSync(statusFile, "{malformed", "utf8");
    mtime += 1_000;
    const stamp = new Date(mtime);
    fs.utimesSync(statusFile, stamp, stamp);
    const before = requestRenderCalls();
    await wait(30);

    expect(orbOf(rendered, "tool-execute-before").props.fg).toBe("error-color");
    expect(requestRenderCalls()).toBe(before);

    fs.rmSync(statusFile);
    await wait(30);
    expect(orbOf(rendered, "tool-execute-before").props.fg).toBe("error-color");
  });

  test("should prune destroyed handles without crashing", async () => {
    const { root, hooksDir } = makeWorkspace();
    fs.writeFileSync(path.join(hooksDir, "tool-execute-before.sh"), "");
    const statusFile = path.join(root, "status.json");
    const { api, slots, requestRenderCalls } = makeFakeApi(root);
    const { runtime, roots } = makeSolid();

    await registerActiveHooksSidebar(api, root, async () => runtime, {
      statusFile,
      pollMs: 5,
    });
    const rendered = slots[0]!.slots.sidebar_content!(
      slotContext(),
      {},
    ) as FakeNode;
    writeStatusSnapshot(statusFile, { "tool.execute.before": "pending" });
    await wait(30);
    expect(orbOf(rendered, "tool-execute-before").props.fg).toBe("warning-color");

    roots[0]!.isDestroyed = true;
    const before = requestRenderCalls();
    writeStatusSnapshot(statusFile, { "tool.execute.before": "success" });
    await wait(30);

    expect(requestRenderCalls()).toBe(before);
    expect(orbOf(rendered, "tool-execute-before").props.fg).toBe("warning-color");
  });

  test("should keep a settled hook's status until its next run", async () => {
    const { root, hooksDir } = makeWorkspace();
    for (const file of [
      "tool-execute-before.sh",
      "chat-message.sh",
      "event.sh",
    ]) {
      fs.writeFileSync(path.join(hooksDir, file), "");
    }
    const statusFile = path.join(root, "status.json");
    let clock = Date.now();
    writeStatusSnapshot(
      statusFile,
      {
        "tool.execute.before": "success",
        "chat.message": "failure",
        "event": "pending",
      },
      clock,
    );
    const { api, slots } = makeFakeApi(root);
    const { runtime } = makeSolid();

    await registerActiveHooksSidebar(api, root, async () => runtime, {
      statusFile,
      pollMs: 5,
      now: () => clock,
    });
    const rendered = slots[0]!.slots.sidebar_content!(
      slotContext(),
      {},
    ) as FakeNode;
    await wait(30);

    expect(orbOf(rendered, "tool-execute-before").props.fg).toBe(
      "success-color",
    );
    expect(statusOf(rendered, "tool-execute-before").props.content).toBe(
      "Success",
    );
    expect(orbOf(rendered, "chat-message").props.fg).toBe("error-color");
    expect(orbOf(rendered, "event").props.fg).toBe("warning-color");

    clock += 60_000;
    await wait(30);

    expect(orbOf(rendered, "tool-execute-before").props.fg).toBe(
      "success-color",
    );
    expect(statusOf(rendered, "tool-execute-before").props.content).toBe(
      "Success",
    );
    expect(orbOf(rendered, "chat-message").props.fg).toBe("error-color");
    expect(orbOf(rendered, "event").props.fg).toBe("warning-color");

    writeStatusSnapshot(
      statusFile,
      {
        "tool.execute.before": "pending",
        "chat.message": "failure",
        "event": "pending",
      },
      clock,
    );
    await wait(30);

    expect(orbOf(rendered, "tool-execute-before").props.fg).toBe(
      "warning-color",
    );
    expect(statusOf(rendered, "tool-execute-before").props.content).toBe(
      "In progress",
    );
  });

  test("should start a session idle and only light up on a run after the panel opens", async () => {
    const { root, hooksDir } = makeWorkspace();
    fs.writeFileSync(path.join(hooksDir, "event.sh"), "");
    const statusFile = path.join(root, "status.json");
    let clock = Date.now();
    writeStatusSnapshot(statusFile, { event: "success" }, clock);
    const { api, slots } = makeFakeApi(root);
    const { runtime } = makeSolid();

    await registerActiveHooksSidebar(api, root, async () => runtime, {
      statusFile,
      pollMs: 5,
      now: () => clock,
    });
    clock += 500;
    const rendered = slots[0]!.slots.sidebar_content!(
      slotContext(),
      { session_id: "ses_one" },
    ) as FakeNode;
    await wait(30);

    expect(orbOf(rendered, "event").props.fg).toBe("muted-color");
    expect(statusOf(rendered, "event").props.content).toBe("Idle");

    writeStatusSnapshot(statusFile, { event: "success" }, clock);
    await wait(30);

    expect(orbOf(rendered, "event").props.fg).toBe("success-color");
    expect(statusOf(rendered, "event").props.content).toBe("Success");
  });

  test("should keep the previous session's statuses out of a new session panel", async () => {
    const { root, hooksDir } = makeWorkspace();
    fs.writeFileSync(path.join(hooksDir, "event.sh"), "");
    const statusFile = path.join(root, "status.json");
    let clock = Date.now();
    writeStatusSnapshot(statusFile, { event: "success" }, clock);
    const { api, slots } = makeFakeApi(root);
    const { runtime } = makeSolid();

    await registerActiveHooksSidebar(api, root, async () => runtime, {
      statusFile,
      pollMs: 5,
      now: () => clock,
    });
    const first = slots[0]!.slots.sidebar_content!(
      slotContext(),
      { session_id: "ses_one" },
    ) as FakeNode;
    await wait(30);
    expect(orbOf(first, "event").props.fg).toBe("success-color");

    clock += 1_000;
    const second = slots[0]!.slots.sidebar_content!(
      slotContext(),
      { session_id: "ses_two" },
    ) as FakeNode;
    expect(orbOf(second, "event").props.fg).toBe("muted-color");
    expect(statusOf(second, "event").props.content).toBe("Idle");
    expect(orbOf(first, "event").props.fg).toBe("success-color");
  });

  test("should stop polling on dispose", async () => {
    const { root, hooksDir } = makeWorkspace();
    fs.writeFileSync(path.join(hooksDir, "tool-execute-before.sh"), "");
    const statusFile = path.join(root, "status.json");
    const { api, slots, disposeCallbacks, requestRenderCalls } = makeFakeApi(root);
    const { runtime } = makeSolid();

    await registerActiveHooksSidebar(api, root, async () => runtime, {
      statusFile,
      pollMs: 5,
    });
    const rendered = slots[0]!.slots.sidebar_content!(
      slotContext(),
      {},
    ) as FakeNode;
    writeStatusSnapshot(statusFile, { "tool.execute.before": "pending" });
    await wait(30);
    expect(orbOf(rendered, "tool-execute-before").props.fg).toBe("warning-color");

    for (const dispose of disposeCallbacks.splice(0)) dispose();
    const before = requestRenderCalls();
    writeStatusSnapshot(statusFile, { "tool.execute.before": "success" });
    await wait(30);

    expect(orbOf(rendered, "tool-execute-before").props.fg).toBe("warning-color");
    expect(requestRenderCalls()).toBe(before);
  });

  test("should show '(none)' when no hooks are registered", async () => {
    const { root } = makeWorkspace();
    const { api, slots } = makeFakeApi(root);
    const { runtime } = makeSolid();
    const statusFile = path.join(root, "status.json");

    await registerActiveHooksSidebar(api, root, async () => runtime, {
      statusFile,
      pollMs: 5,
    });
    const rendered = slots[0]!.slots.sidebar_content!(
      slotContext(),
      {},
    ) as FakeNode;

    const empty = rendered.children[1] as FakeNode;
    expect(empty.props.content).toBe("(none)");
    expect(empty.props.fg).toBe("muted-color");
  });

  test("should register the sidebar through the host Solid runtime at activation", async () => {
    const { root, hooksDir } = makeWorkspace();
    fs.writeFileSync(path.join(hooksDir, "chat-message.sh"), "");
    const { api, slots } = makeFakeApi(root);
    const { runtime } = makeSolid();
    mock.module("@opentui/solid", () => runtime);

    await tuiModule.tui(api);

    expect(slots).toHaveLength(1);
    expect(Object.keys(slots[0]!.slots)).toEqual(["sidebar_content"]);
  });

  test("should touch only the sidebar slot, renderer, lifecycle, and ui surfaces", async () => {
    const { root, hooksDir } = makeWorkspace();
    fs.writeFileSync(path.join(hooksDir, "tool-execute-before.sh"), "");
    const { api, slots, accessed } = makeFakeApi(root);
    const { runtime } = makeSolid();

    await registerActiveHooksSidebar(api, root, async () => runtime, {
      statusFile: path.join(root, "status.json"),
      logFile: path.join(root, "missing-logs.jsonl"),
      pollMs: 5,
    });
    const rendered = slots[0]!.slots.sidebar_content!(
      slotContext(),
      {},
    ) as FakeNode;
    clickRow(rendered, "tool-execute-before");

    expect([...new Set(accessed)].sort()).toEqual([
      "lifecycle",
      "renderer",
      "slots",
      "ui",
    ]);
  });

  test("should skip polling when OWFLOW_HOOKS_DISABLED=1", async () => {
    const previous = process.env.OWFLOW_HOOKS_DISABLED;
    process.env.OWFLOW_HOOKS_DISABLED = "1";
    try {
      const { root, hooksDir } = makeWorkspace();
      fs.writeFileSync(path.join(hooksDir, "tool-execute-before.sh"), "");
      const { api, slots, accessed } = makeFakeApi(root);
      const { runtime } = makeSolid();

      await registerActiveHooksSidebar(api, root, async () => runtime, {
        statusFile: path.join(root, "status.json"),
        pollMs: 5,
      });
      const rendered = slots[0]!.slots.sidebar_content!(
        slotContext(),
        {},
      ) as FakeNode;

      expect([...new Set(accessed)].sort()).toEqual(["slots"]);
      const hookRow = row(rendered, "tool-execute-before");
      expect(hookRow.props.onMouseUp).toBeUndefined();
      expect(hookRow.props.onMouseOver).toBeUndefined();
      expect([...new Set(accessed)].sort()).toEqual(["slots"]);
    } finally {
      if (previous === undefined) delete process.env.OWFLOW_HOOKS_DISABLED;
      else process.env.OWFLOW_HOOKS_DISABLED = previous;
    }
  });

  test("should warn and skip registration when the workspace directory is unavailable", async () => {
    const { api, slots } = makeFakeApi("");
    const warn = spyOn(console, "warn").mockImplementation(() => {});

    try {
      await tuiModule.tui(api);

      expect(slots).toHaveLength(0);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});
