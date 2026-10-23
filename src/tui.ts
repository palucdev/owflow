import path from "node:path";
import type {
  TuiPluginApi,
  TuiPluginModule,
} from "@opencode-ai/plugin/tui";
import { scanHooks } from "./hooks-wrapper/registry.js";
import { HookDigestMode } from "./types/hook-types.js";
import type { HookRegistryEntry } from "./types/hook-types.js";
import { hooksDirectory } from "./utils/workflow-paths.js";

const SIDEBAR_SLOT = "sidebar_content";
const ACTIVE_HOOKS_TITLE = "Active hooks:";
const EMPTY_HOOKS_NAME = "(none)";
const SOLID_RUNTIME_MODULE = "@opentui/solid";

/**
 * Minimal surface of the host-provided Solid runtime needed to build nodes
 * without JSX. The TUI process owns this peer; owflow only consumes it.
 */
interface SolidRuntime {
  readonly createElement: (tag: string) => unknown;
  readonly insert: (parent: unknown, child: unknown) => unknown;
  readonly setProp: (node: unknown, name: string, value: unknown) => unknown;
}

interface SidebarTheme {
  readonly text: unknown;
  readonly textMuted: unknown;
}

interface SidebarSlotContext {
  readonly theme: { readonly current: SidebarTheme };
}

/**
 * A3: the TUI is a separate process from the server, so the live registry is
 * unreachable; this re-derives the would-load set with the same pure modules.
 */
export const activeHookNames = (
  entries: readonly HookRegistryEntry[],
): readonly string[] =>
  entries.map((entry) => path.basename(entry.path, path.extname(entry.path)));

export const buildActiveHooksView = (
  directory: string,
): { readonly title: string; readonly names: readonly string[] } => {
  const scan = scanHooks(hooksDirectory(directory), {
    mode: HookDigestMode.Report,
  });
  return {
    title: ACTIVE_HOOKS_TITLE,
    names: activeHookNames(scan.registry.entries),
  };
};

const materializeSidebar = (
  view: { readonly title: string; readonly names: readonly string[] },
  theme: SidebarTheme,
  solid: SolidRuntime,
): unknown => {
  const root = solid.createElement("box");
  solid.setProp(root, "flexDirection", "column");

  const title = solid.createElement("text");
  solid.setProp(title, "fg", theme.textMuted);
  solid.insert(title, view.title);
  solid.insert(root, title);

  const names = view.names.length > 0 ? view.names : [EMPTY_HOOKS_NAME];
  for (const name of names) {
    const line = solid.createElement("text");
    solid.setProp(line, "fg", theme.text);
    solid.insert(line, `- ${name}`);
    solid.insert(root, line);
  }
  return root;
};

const loadSolidRuntime = async (): Promise<SolidRuntime | null> => {
  try {
    const runtime = (await import(SOLID_RUNTIME_MODULE)) as Partial<SolidRuntime>;
    if (
      typeof runtime.createElement !== "function" ||
      typeof runtime.insert !== "function" ||
      typeof runtime.setProp !== "function"
    ) {
      return null;
    }
    return runtime as SolidRuntime;
  } catch {
    return null;
  }
};

/**
 * Registers the always-on right-hand sidebar panel. The panel lists every
 * loaded hook by name; because hooks only reload on restart, one scan at
 * activation is sufficient.
 */
export const registerActiveHooksSidebar = async (
  api: TuiPluginApi,
  directory: string,
  loadSolid: () => Promise<SolidRuntime | null> = loadSolidRuntime,
): Promise<boolean> => {
  const solid = await loadSolid();
  if (solid === null) {
    console.warn(
      "[owflow] TUI Solid runtime unavailable; cannot render the active hooks panel.",
    );
    return false;
  }

  const view = buildActiveHooksView(directory);
  api.slots.register({
    order: 50,
    slots: {
      [SIDEBAR_SLOT]: (ctx: SidebarSlotContext) =>
        materializeSidebar(view, ctx.theme.current, solid),
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
