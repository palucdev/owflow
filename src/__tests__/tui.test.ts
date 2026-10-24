import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import tuiModule, {
  buildActiveHooksView,
  colorForStatus,
  registerActiveHooksSidebar,
  statusLabelFor,
} from "../tui.js";
import type { SidebarTheme } from "../tui.js";
import { scanHooks } from "../hooks-wrapper/registry.js";
import { HookDigestMode } from "../types/hook-types.js";
import type { HookRunState } from "../types/hook-types.js";

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

interface FakeApi {
  readonly api: TuiPluginApi;
  readonly slots: FakeSlotRegistration[];
  readonly accessed: string[];
  readonly disposeCallbacks: (() => void)[];
  readonly requestRenderCalls: () => number;
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
): void => {
  const entries = Object.fromEntries(
    Object.entries(hooks).map(([event, status]) => [
      event,
      { status, startedAt: 1, ...(status === "success" ? { finishedAt: 2 } : {}) },
    ]),
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      pid: 1,
      workspace: path.dirname(file),
      updatedAt: 1,
      hooks: entries,
    }),
    "utf8",
  );
  mtime += 1_000;
  const stamp = new Date(mtime);
  fs.utimesSync(file, stamp, stamp);
};

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const nodeText = (node: FakeNode): string =>
  typeof node.props.content === "string"
    ? node.props.content
    : typeof node.children[0] === "string"
      ? node.children[0]
      : "";

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
    fs.writeFileSync(path.join(hooksDir, "config.ts"), "");

    const scan = scanHooks(hooksDir, { mode: HookDigestMode.Report });
    expect(scan.registry.entries.map((entry) => entry.event)).toEqual([
      "config",
      "tool.execute.before",
    ]);
    expect(buildActiveHooksView(root)).toEqual({
      title: "Active hooks:",
      rows: [
        { name: "config", event: "config" },
        { name: "tool-execute-before", event: "tool.execute.before" },
      ],
    });
  });

  test("should map pending, success, failure, and idle to the shared theme", () => {
    expect(colorForStatus("pending", THEME)).toBe("warning-color");
    expect(colorForStatus("success", THEME)).toBe("success-color");
    expect(colorForStatus("failure", THEME)).toBe("error-color");
    expect(colorForStatus(undefined, THEME)).toBe("muted-color");
    expect(statusLabelFor("pending")).toBe("Running");
    expect(statusLabelFor("success")).toBe("Success");
    expect(statusLabelFor("failure")).toBe("Error");
    expect(statusLabelFor(undefined)).toBe("Idle");
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

    const [orb, name, state] = hook!.children as FakeNode[];
    expect(orb!.props.content).toBe("•");
    expect(orb!.props.fg).toBe("muted-color");
    expect(name!.props.content).toBe("tool-execute-before");
    expect(name!.props.fg).toBe("text-color");
    expect(state!.props.content).toBe("Idle");
    expect(state!.props.fg).toBe("muted-color");
  });

  test("should apply pending, success, failure, and idle colors from the status snapshot", async () => {
    const { root, hooksDir } = makeWorkspace();
    for (const file of [
      "tool-execute-before.sh",
      "chat-message.ts",
      "event.ts",
      "dispose.sh",
    ]) {
      fs.writeFileSync(path.join(hooksDir, file), "");
    }
    const statusFile = path.join(root, "status.json");
    writeStatusSnapshot(statusFile, {
      "tool.execute.before": "pending",
      "chat.message": "success",
      event: "failure",
    });
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
    await wait(30);

    expect(roots[0]!.isDestroyed).toBeUndefined();
    expect(orbOf(rendered, "tool-execute-before").props.fg).toBe(
      "warning-color",
    );
    expect(statusOf(rendered, "tool-execute-before").props.content).toBe(
      "Running",
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
    writeStatusSnapshot(statusFile, { "tool.execute.before": "pending" });
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
    await wait(30);
    expect(orbOf(rendered, "tool-execute-before").props.fg).toBe(
      "warning-color",
    );
    expect(statusOf(rendered, "tool-execute-before").props.content).toBe(
      "Running",
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
    writeStatusSnapshot(statusFile, { "tool.execute.before": "failure" });
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
    writeStatusSnapshot(statusFile, { "tool.execute.before": "pending" });
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
    await wait(30);
    expect(orbOf(rendered, "tool-execute-before").props.fg).toBe("warning-color");

    roots[0]!.isDestroyed = true;
    const before = requestRenderCalls();
    writeStatusSnapshot(statusFile, { "tool.execute.before": "success" });
    await wait(30);

    expect(requestRenderCalls()).toBe(before);
    expect(orbOf(rendered, "tool-execute-before").props.fg).toBe("warning-color");
  });

  test("should stop polling on dispose", async () => {
    const { root, hooksDir } = makeWorkspace();
    fs.writeFileSync(path.join(hooksDir, "tool-execute-before.sh"), "");
    const statusFile = path.join(root, "status.json");
    writeStatusSnapshot(statusFile, { "tool.execute.before": "pending" });
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
    fs.writeFileSync(path.join(hooksDir, "chat-message.ts"), "");
    const { api, slots } = makeFakeApi(root);
    const { runtime } = makeSolid();
    mock.module("@opentui/solid", () => runtime);

    await tuiModule.tui(api);

    expect(slots).toHaveLength(1);
    expect(Object.keys(slots[0]!.slots)).toEqual(["sidebar_content"]);
  });

  test("should touch only the sidebar slot, renderer, and lifecycle", async () => {
    const { root } = makeWorkspace();
    const { api, slots, accessed } = makeFakeApi(root);
    const { runtime } = makeSolid();

    await registerActiveHooksSidebar(api, root, async () => runtime, {
      statusFile: path.join(root, "status.json"),
      pollMs: 5,
    });
    slots[0]!.slots.sidebar_content!(slotContext(), {});

    expect([...new Set(accessed)].sort()).toEqual([
      "lifecycle",
      "renderer",
      "slots",
    ]);
  });

  test("should skip polling when OWFLOW_HOOKS_DISABLED=1", async () => {
    const previous = process.env.OWFLOW_HOOKS_DISABLED;
    process.env.OWFLOW_HOOKS_DISABLED = "1";
    try {
      const { root } = makeWorkspace();
      const { api, slots, accessed } = makeFakeApi(root);
      const { runtime } = makeSolid();

      await registerActiveHooksSidebar(api, root, async () => runtime, {
        statusFile: path.join(root, "status.json"),
        pollMs: 5,
      });
      slots[0]!.slots.sidebar_content!(slotContext(), {});

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
