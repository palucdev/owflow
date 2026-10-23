import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import tuiModule, {
  activeHookNames,
  buildActiveHooksView,
  registerActiveHooksSidebar,
} from "../tui.js";
import { scanHooks } from "../hooks-wrapper/registry.js";
import { HookDigestMode } from "../types/hook-types.js";

interface FakeNode {
  readonly tag: string;
  readonly props: Record<string, unknown>;
  readonly children: (FakeNode | string)[];
}

interface FakeSlotRegistration {
  readonly order?: number;
  readonly slots: Record<string, (ctx: unknown, props: unknown) => unknown>;
}

interface FakeApi {
  readonly api: TuiPluginApi;
  readonly slots: FakeSlotRegistration[];
  readonly accessed: string[];
}

const makeWorkspace = (): { root: string; hooksDir: string } => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owflow-tui-test-"));
  tempDirs.push(root);
  const hooksDir = path.join(root, ".owflow", "hooks");
  fs.mkdirSync(hooksDir, { recursive: true });
  return { root, hooksDir };
};

const tempDirs: string[] = [];

const slotContext = () => ({
  theme: {
    current: { text: "text-color", textMuted: "muted-color" },
  },
});

const makeFakeApi = (directory: string): FakeApi => {
  const slots: FakeSlotRegistration[] = [];
  const accessed: string[] = [];
  const base = {
    slots: {
      register: (registration: FakeSlotRegistration): string => {
        slots.push(registration);
        return "owflow:0";
      },
    },
    theme: {
      current: { text: "text-color", textMuted: "muted-color" },
    },
    state: { path: { directory } },
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
  return { api, slots, accessed };
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

  test("should list loaded hook names without extensions in registry order", () => {
    const { root, hooksDir } = makeWorkspace();
    fs.writeFileSync(path.join(hooksDir, "tool-execute-before.sh"), "");
    fs.writeFileSync(path.join(hooksDir, "config.ts"), "");

    const scan = scanHooks(hooksDir, { mode: HookDigestMode.Report });
    expect(activeHookNames(scan.registry.entries)).toEqual([
      "config",
      "tool-execute-before",
    ]);
    expect(buildActiveHooksView(root)).toEqual({
      title: "Active hooks:",
      names: ["config", "tool-execute-before"],
    });
  });

  test("should render an always-on right sidebar panel with one line per hook", async () => {
    const { root, hooksDir } = makeWorkspace();
    fs.writeFileSync(path.join(hooksDir, "tool-execute-before.sh"), "");
    const { api, slots } = makeFakeApi(root);
    const { runtime, roots } = makeSolid();

    const registered = await registerActiveHooksSidebar(
      api,
      root,
      async () => runtime,
    );

    expect(registered).toBe(true);
    expect(slots).toHaveLength(1);
    expect(slots[0]!.order).toBe(50);
    expect(Object.keys(slots[0]!.slots)).toEqual(["sidebar_content"]);

    const rendered = slots[0]!.slots.sidebar_content!(slotContext(), {}) as FakeNode;
    expect(rendered).toBe(roots[0]!);
    expect(rendered.tag).toBe("box");
    expect(rendered.props.flexDirection).toBe("column");
    expect(rendered.children).toHaveLength(2);

    const [title, hook] = rendered.children as FakeNode[];
    expect(title!.tag).toBe("text");
    expect(title!.children).toEqual(["Active hooks:"]);
    expect(title!.props.fg).toBe("muted-color");
    expect(hook!.children).toEqual(["- tool-execute-before"]);
    expect(hook!.props.fg).toBe("text-color");
  });

  test("should show '(none)' when no hooks are registered", async () => {
    const { root } = makeWorkspace();
    const { api, slots } = makeFakeApi(root);
    const { runtime } = makeSolid();

    await registerActiveHooksSidebar(api, root, async () => runtime);
    const rendered = slots[0]!.slots.sidebar_content!(slotContext(), {}) as FakeNode;

    expect((rendered.children[1] as FakeNode).children).toEqual(["- (none)"]);
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

  test("should touch only the sidebar slot — never client, session, or model surfaces", async () => {
    const { root } = makeWorkspace();
    const { api, slots, accessed } = makeFakeApi(root);
    const { runtime } = makeSolid();

    await registerActiveHooksSidebar(api, root, async () => runtime);
    slots[0]!.slots.sidebar_content!(slotContext(), {});

    expect([...new Set(accessed)].sort()).toEqual(["slots"]);
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
