import fs from "node:fs";
import path from "node:path";
import type {
  TuiPluginApi,
  TuiPluginModule,
} from "@opencode-ai/plugin/tui";
import { scanHooks } from "./hooks-wrapper/registry.js";
import {
  readHookStatusSnapshot,
  resolveHooksStatusFile,
} from "./hooks-wrapper/status.js";
import { HookDigestMode } from "./types/hook-types.js";
import type {
  DispatchableEvent,
  HookRunState,
  HookStatusReadResult,
} from "./types/hook-types.js";
import { hooksDirectory } from "./utils/workflow-paths.js";

const SIDEBAR_SLOT = "sidebar_content";
const ACTIVE_HOOKS_TITLE = "Active hooks:";
const EMPTY_HOOKS_NAME = "(none)";
const DEFAULT_STATUS_POLL_MS = 200;

/**
 * Minimal surface of the host-provided Solid runtime needed to build nodes
 * without JSX. The TUI process owns this peer; owflow only consumes it.
 */
interface SolidRuntime {
  readonly createElement: (tag: string) => unknown;
  readonly insert: (parent: unknown, child: unknown) => unknown;
  readonly setProp: (node: unknown, name: string, value: unknown) => unknown;
}

export interface SidebarTheme {
  readonly text: unknown;
  readonly textMuted: unknown;
  readonly warning: unknown;
  readonly success: unknown;
  readonly error: unknown;
}

interface SidebarSlotContext {
  readonly theme: { readonly current: SidebarTheme };
}

export interface ActiveHookRow {
  readonly name: string;
  readonly event: DispatchableEvent;
}

export interface ActiveHooksView {
  readonly title: string;
  readonly rows: readonly ActiveHookRow[];
}

/**
 * A3: the TUI is a separate process from the server, so the live registry is
 * unreachable; this re-derives the would-load set with the same pure modules.
 */
export const buildActiveHooksView = (directory: string): ActiveHooksView => {
  const scan = scanHooks(hooksDirectory(directory), {
    mode: HookDigestMode.Report,
  });
  return {
    title: ACTIVE_HOOKS_TITLE,
    rows: scan.registry.entries.map((entry) => ({
      name: path.basename(entry.path, path.extname(entry.path)),
      event: entry.event,
    })),
  };
};

type StatusColorKey = HookRunState | "idle";

const HOOK_STATUS_ORB = "•";

/** Status text follows the same vocabulary everywhere in the panel. */
export const statusLabelFor = (status: HookRunState | undefined): string => {
  switch (status) {
    case "pending":
      return "Running";
    case "success":
      return "Success";
    case "failure":
      return "Error";
    default:
      return "Idle";
  }
};

/** Pure color mapping so idle, pending, success, and failure stay one table. */
export const colorForStatus = (
  status: HookRunState | undefined,
  theme: SidebarTheme,
): unknown => {
  switch (status) {
    case "pending":
      return theme.warning;
    case "success":
      return theme.success;
    case "failure":
      return theme.error;
    default:
      return theme.textMuted;
  }
};

const colorKeyForStatus = (status: HookRunState | undefined): StatusColorKey =>
  status ?? "idle";

const isDestroyed = (node: unknown): boolean => {
  if (typeof node !== "object" || node === null) return false;
  return (node as { readonly isDestroyed?: unknown }).isDestroyed === true;
};

interface HookRowNodes {
  readonly orb: unknown;
  readonly label: unknown;
}

export interface SidebarRenderHandle {
  readonly root: unknown;
  readonly rows: Map<string, HookRowNodes>;
  readonly colors: Map<string, string>;
  readonly theme: SidebarTheme;
  disposed: () => boolean;
}

const staticText = (
  solid: SolidRuntime,
  content: string,
  color: unknown,
): unknown => {
  const node = solid.createElement("text");
  solid.setProp(node, "fg", color);
  solid.setProp(node, "content", content);
  return node;
};

const materializeSidebar = (
  view: ActiveHooksView,
  theme: SidebarTheme,
  solid: SolidRuntime,
): SidebarRenderHandle => {
  const root = solid.createElement("box");
  solid.setProp(root, "flexDirection", "column");

  const title = solid.createElement("text");
  solid.setProp(title, "fg", theme.text);
  solid.insert(title, view.title);
  solid.insert(root, title);

  const rows = new Map<string, HookRowNodes>();
  const colors = new Map<string, string>();
  if (view.rows.length === 0) {
    solid.insert(
      root,
      staticText(solid, EMPTY_HOOKS_NAME, theme.textMuted),
    );
  } else {
    for (const row of view.rows) {
      const line = solid.createElement("box");
      solid.setProp(line, "flexDirection", "row");
      solid.setProp(line, "gap", 1);

      const orb = staticText(
        solid,
        HOOK_STATUS_ORB,
        colorForStatus(undefined, theme),
      );
      solid.setProp(orb, "flexShrink", 0);
      const name = staticText(solid, row.name, theme.text);
      const label = staticText(
        solid,
        statusLabelFor(undefined),
        theme.textMuted,
      );

      solid.insert(line, orb);
      solid.insert(line, name);
      solid.insert(line, label);
      solid.insert(root, line);
      rows.set(row.event, { orb, label });
      colors.set(row.event, colorKeyForStatus(undefined));
    }
  }

  return {
    root,
    rows,
    colors,
    theme,
    disposed: () => isDestroyed(root),
  };
};

const applyStatuses = (
  handle: SidebarRenderHandle,
  statuses: ReadonlyMap<string, HookRunState>,
  solid: SolidRuntime,
): boolean => {
  let changed = false;
  for (const [event, nodes] of handle.rows) {
    const status = statuses.get(event);
    const key = colorKeyForStatus(status);
    if (handle.colors.get(event) === key) continue;
    solid.setProp(nodes.orb, "fg", colorForStatus(status, handle.theme));
    solid.setProp(nodes.label, "content", statusLabelFor(status));
    handle.colors.set(event, key);
    changed = true;
  }
  return changed;
};

const loadSolidRuntime = async (): Promise<SolidRuntime | null> => {
  try {
    const runtime = (await import("@opentui/solid")) as Partial<SolidRuntime>;
    if (
      typeof runtime.createElement !== "function" ||
      typeof runtime.insert !== "function" ||
      typeof runtime.setProp !== "function"
    ) {
      return null;
    }
    return runtime as SolidRuntime;
  } catch (error) {
    console.warn("[owflow] Failed to import @opentui/solid", error);
    return null;
  }
};

export interface ActiveHooksSidebarOptions {
  readonly statusFile?: string;
  readonly readSnapshot?: (file: string) => HookStatusReadResult;
  readonly pollMs?: number;
}

/**
 * Registers the always-on right-hand sidebar panel. The hook set is scanned
 * once (hooks reload only on restart); runtime status is polled from the
 * dispatcher's overwritten snapshot file and applied imperatively.
 */
export const registerActiveHooksSidebar = async (
  api: TuiPluginApi,
  directory: string,
  loadSolid: () => Promise<SolidRuntime | null> = loadSolidRuntime,
  options: ActiveHooksSidebarOptions = {},
): Promise<boolean> => {
  const solid = await loadSolid();
  if (solid === null) {
    console.warn(
      "[owflow] TUI Solid runtime unavailable; cannot render the active hooks panel.",
    );
    return false;
  }

  const view = buildActiveHooksView(directory);
  const statusFile = options.statusFile ?? resolveHooksStatusFile(directory);
  const readSnapshot = options.readSnapshot ?? readHookStatusSnapshot;
  const handles: SidebarRenderHandle[] = [];
  let statuses = new Map<string, HookRunState>();
  let lastMtime: number | undefined;

  const applyToHandle = (handle: SidebarRenderHandle): boolean => {
    try {
      return applyStatuses(handle, statuses, solid);
    } catch {
      return false;
    }
  };

  const pollingEnabled = process.env.OWFLOW_HOOKS_DISABLED !== "1";
  if (pollingEnabled) {
    const renderer = api.renderer;

    const tick = (): void => {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(statusFile);
      } catch {
        lastMtime = undefined;
        return;
      }
      if (!stat.isFile()) {
        lastMtime = undefined;
        return;
      }
      if (lastMtime === stat.mtimeMs) return;
      lastMtime = stat.mtimeMs;

      const result = readSnapshot(statusFile);
      if (result.kind !== "ok") return;

      const next = new Map<string, HookRunState>();
      for (const [event, runtime] of Object.entries(result.snapshot.hooks)) {
        next.set(event, runtime.status);
      }
      statuses = next;

      for (const handle of handles) {
        if (handle.disposed()) continue;
        if (applyToHandle(handle)) renderer.requestRender();
      }
      for (let index = handles.length - 1; index >= 0; index -= 1) {
        if (handles[index]!.disposed()) handles.splice(index, 1);
      }
    };

    const timer = setInterval(tick, options.pollMs ?? DEFAULT_STATUS_POLL_MS);
    if (typeof (timer as { unref?: () => void }).unref === "function") {
      (timer as { unref: () => void }).unref();
    }
    api.lifecycle.onDispose(() => clearInterval(timer));
  }

  api.slots.register({
    order: 50,
    slots: {
      [SIDEBAR_SLOT]: (ctx: SidebarSlotContext) => {
        const handle = materializeSidebar(view, ctx.theme.current, solid);
        applyToHandle(handle);
        handles.push(handle);
        return handle.root;
      },
    },
  });
  return true;
};

const tui = async (api: TuiPluginApi): Promise<void> => {
  const directory = api.state.path.directory;
  if (typeof directory !== "string" || directory.length === 0) {
    console.warn(
      "[owflow] workspace directory unavailable; cannot render the active hooks panel.",
    );
    return;
  }
  await registerActiveHooksSidebar(api, directory);
};

export default { id: "owflow", tui } satisfies TuiPluginModule;
