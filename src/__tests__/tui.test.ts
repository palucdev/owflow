import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TuiPluginApi, TuiToast } from "@opencode-ai/plugin/tui";
import tuiModule, { workspaceUnavailableToast } from "../tui.js";
import { scanHooks } from "../hooks-wrapper/registry.js";
import {
  EFFECTIVE_AFTER_RESTART,
  renderTable,
} from "../hooks-wrapper/report.js";

interface FakeLayerCommand {
  readonly name: string;
  readonly title: string;
  readonly namespace: string;
  readonly slashName: string;
  readonly run: () => void;
}

interface FakeLayer {
  readonly commands: readonly FakeLayerCommand[];
  readonly bindings: readonly unknown[];
}

const makeWorkspace = (): { root: string; hooksDir: string } => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owflow-tui-test-"));
  tempDirs.push(root);
  const hooksDir = path.join(root, ".owflow", "hooks");
  fs.mkdirSync(hooksDir, { recursive: true });
  return { root, hooksDir };
};

const tempDirs: string[] = [];

interface FakeApi {
  readonly api: TuiPluginApi;
  readonly layers: FakeLayer[];
  readonly toasts: TuiToast[];
  readonly accessed: string[];
}

const makeFakeApi = (directory: string, record = true): FakeApi => {
  const layers: FakeLayer[] = [];
  const toasts: TuiToast[] = [];
  const accessed: string[] = [];
  const base = {
    keymap: {
      registerLayer: (layer: FakeLayer): (() => void) => {
        layers.push(layer);
        return () => {};
      },
    },
    ui: {
      toast: (toast: TuiToast): void => {
        toasts.push(toast);
      },
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
      if (record) accessed.push(String(property));
      return Reflect.get(target, property, receiver);
    },
  }) as unknown as TuiPluginApi;
  return { api, layers, toasts, accessed };
};

describe("owflow TUI plugin", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("should default-export a tui-only module: id owflow, a tui function, and no server key", () => {
    expect(tuiModule.id).toBe("owflow");
    expect(typeof tuiModule.tui).toBe("function");
    expect("server" in tuiModule).toBe(false);
  });

  test("should register one palette command whose run renders the report through api.ui.toast", async () => {
    const { root } = makeWorkspace();
    const { api, layers, toasts } = makeFakeApi(root);

    await tuiModule.tui(api);

    expect(layers).toHaveLength(1);
    const layer = layers[0]!;
    expect(layer.bindings).toEqual([]);
    expect(layer.commands).toHaveLength(1);
    const command = layer.commands[0]!;
    expect(command.name).toBe("show-hooks");
    expect(command.namespace).toBe("palette");
    expect(command.slashName).toBe("owflow:show-hooks");
    expect(typeof command.run).toBe("function");
    expect(toasts).toHaveLength(0);

    command.run();

    expect(toasts).toHaveLength(1);
  });

  test("should toast exactly the shared report table for the same would-load scan", async () => {
    const { root, hooksDir } = makeWorkspace();
    fs.writeFileSync(path.join(hooksDir, "tool-execute-before.sh"), "");
    const { api, layers, toasts } = makeFakeApi(root);

    await tuiModule.tui(api);
    layers[0]!.commands[0]!.run();

    const scan = scanHooks(hooksDir, { mode: "report" });
    const expected = renderTable({
      entries: scan.registry.entries,
      failures: scan.failures,
    });

    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.message).toBe(expected);
    expect(toasts[0]!.message).toContain(EFFECTIVE_AFTER_RESTART);
  });

  test("should touch only keymap, state.path, and ui — never client, session, or model surfaces", async () => {
    const { root } = makeWorkspace();
    const { api, layers, accessed } = makeFakeApi(root);

    await tuiModule.tui(api);
    layers[0]!.commands[0]!.run();

    expect([...new Set(accessed)].sort()).toEqual(["keymap", "state", "ui"]);
  });

  test("should warn when the workspace directory is unavailable", async () => {
    const { api, layers, toasts } = makeFakeApi("");

    await tuiModule.tui(api);
    layers[0]!.commands[0]!.run();

    expect(toasts).toEqual([workspaceUnavailableToast()]);
  });
});
