import fs from "node:fs";
import path from "node:path";
import type { TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { scanHooks } from "./hooks-wrapper/registry.js";
import {
  readLatestHookLog,
  resolveHooksLogFile,
} from "./hooks-wrapper/hook-logs.js";
import {
  readHookStatusSnapshot,
  resolveHooksStatusFile,
} from "./hooks-wrapper/status.js";
import { HookDigestMode } from "./types/hook-types.js";
import type {
  HookEventName,
  HookRunLogRecord,
  HookRunState,
  HookRuntimeEntry,
  HookStatusReadResult,
} from "./types/hook-types.js";
import { hooksDirectory } from "./utils/workflow-paths.js";

const SIDEBAR_SLOT = "sidebar_content";
const ACTIVE_HOOKS_TITLE = "Active hooks:";
const EMPTY_HOOKS_NAME = "(none)";
const OPEN_HINT = "›";
const SHOW_LOGS_LABEL = "View logs";
const DETAIL_DIALOG_SIZE = "large";
const RUN_SUMMARY_MAX_CHARS = 4_000;
const LOGS_MESSAGE_MAX_CHARS = 8_000;
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
  readonly primary: unknown;
  readonly selectedListItemText: unknown;
  readonly backgroundElement: unknown;
  readonly warning: unknown;
  readonly success: unknown;
  readonly error: unknown;
}

type SolidElement = ReturnType<TuiPluginApi["ui"]["Dialog"]>;

interface SidebarSlotContext {
  readonly theme: { readonly current: SidebarTheme };
}

interface SidebarSlotProps {
  readonly session_id?: string;
}

export interface ActiveHookRow {
  readonly name: string;
  readonly event: HookEventName;
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
      return "In progress";
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

/**
 * The last outcome stays visible until the hook runs again (pending is shown
 * while it runs). Runs that started before the panel opened for the session
 * are ignored, so statuses left behind by an earlier session or a previous
 * process never show as green at session start.
 */
export const statusForDisplay = (
  entry: HookRuntimeEntry | undefined,
  notBefore = Number.NEGATIVE_INFINITY,
): HookRunState | undefined => {
  if (entry === undefined) return undefined;
  if (entry.startedAt < notBefore) return undefined;
  return entry.status;
};

export const effectiveStatuses = (
  entries: ReadonlyMap<string, HookRuntimeEntry>,
  notBefore = Number.NEGATIVE_INFINITY,
): Map<string, HookRunState> => {
  const statuses = new Map<string, HookRunState>();
  for (const [event, entry] of entries) {
    const status = statusForDisplay(entry, notBefore);
    if (status !== undefined) statuses.set(event, status);
  }
  return statuses;
};

const truncateMessage = (message: string, maxChars: number): string => {
  if (message.length <= maxChars) return message;
  const suffix = "\n[message truncated]";
  return message.slice(0, Math.max(0, maxChars - suffix.length)) + suffix;
};

/**
 * Run metadata shown in the detail popup. Captured output is intentionally
 * omitted here; it lives in the separate logs popup behind the "View logs" button.
 */
export const formatHookRunSummary = (
  record: HookRunLogRecord,
  maxChars = RUN_SUMMARY_MAX_CHARS,
): string => {
  const lines: string[] = [
    `Event:  ${record.event}`,
    `Status: ${record.status === "success" ? "Success" : "Error"} — ${record.durationMs} ms`,
    `Time:   ${new Date(record.finishedAt).toISOString()}`,
  ];
  if (record.sessionID !== undefined) {
    lines.push(`Session: ${record.sessionID}`);
  }
  if (record.exitCode !== undefined) {
    lines.push(`Exit:   ${record.exitCode === null ? "none" : record.exitCode}`);
  }
  if (record.signal !== undefined && record.signal !== null) {
    lines.push(`Signal: ${record.signal}`);
  }
  if (record.reason !== undefined) {
    lines.push("", `Reason: ${record.reason}`);
  }

  return truncateMessage(lines.join("\n"), maxChars);
};

/**
 * Plain-text logs popup body. Bounded by a character budget because the host
 * alert does not scroll; captured streams are already byte-capped by the store.
 */
export const formatHookLogsMessage = (
  record: HookRunLogRecord,
  maxChars = LOGS_MESSAGE_MAX_CHARS,
): string => {
  const sections: string[] = [];
  const section = (title: string, text: string): void => {
    sections.push(`--- ${title} ---\n${text}`);
  };
  if (record.stderr !== undefined) section("stderr", record.stderr);
  if (record.stdout !== undefined) section("stdout", record.stdout);
  if (sections.length === 0) {
    sections.push("No output captured for this run.");
  }
  if (record.truncated === true) {
    sections.push("[output truncated]");
  }

  return truncateMessage(sections.join("\n\n"), maxChars);
};

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
  readonly notBefore: number;
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

const buildHookRunDetailBody = (
  record: HookRunLogRecord,
  theme: SidebarTheme,
  solid: SolidRuntime,
  onShowLogs: () => void,
  onClose: () => void,
): unknown => {
  const root = solid.createElement("box");
  solid.setProp(root, "flexDirection", "column");
  solid.setProp(root, "alignItems", "center");
  solid.setProp(root, "width", "100%");
  solid.setProp(root, "paddingLeft", 2);
  solid.setProp(root, "paddingRight", 2);
  solid.setProp(root, "paddingTop", 1);
  solid.setProp(root, "paddingBottom", 1);
  solid.setProp(root, "gap", 1);

  const header = solid.createElement("box");
  solid.setProp(header, "flexDirection", "row");
  solid.setProp(header, "alignItems", "center");
  solid.setProp(header, "justifyContent", "space-between");
  solid.setProp(header, "width", "100%");
  solid.setProp(header, "gap", 1);
  const title = staticText(solid, `Hook run: ${record.name}`, theme.text);
  solid.setProp(title, "flexGrow", 1);
  solid.setProp(title, "textAlign", "center");
  solid.insert(header, title);
  const closeHint = staticText(solid, "esc", theme.textMuted);
  solid.setProp(closeHint, "flexShrink", 0);
  solid.setProp(closeHint, "onMouseUp", onClose);
  solid.insert(header, closeHint);
  solid.insert(root, header);

  const summary = staticText(
    solid,
    formatHookRunSummary(record),
    theme.textMuted,
  );
  solid.setProp(summary, "width", "100%");
  solid.setProp(summary, "textAlign", "center");
  solid.insert(root, summary);

  const buttonRow = solid.createElement("box");
  solid.setProp(buttonRow, "flexDirection", "row");
  solid.setProp(buttonRow, "justifyContent", "center");
  solid.setProp(buttonRow, "width", "100%");
  const button = solid.createElement("box");
  solid.setProp(button, "backgroundColor", theme.primary);
  solid.setProp(button, "paddingLeft", 3);
  solid.setProp(button, "paddingRight", 3);
  solid.setProp(button, "onMouseUp", onShowLogs);
  const buttonLabel = staticText(
    solid,
    SHOW_LOGS_LABEL,
    theme.selectedListItemText,
  );
  solid.setProp(buttonLabel, "flexShrink", 0);
  solid.setProp(button, "onMouseOver", () => {
    solid.setProp(button, "backgroundColor", theme.backgroundElement);
    solid.setProp(buttonLabel, "fg", theme.primary);
  });
  solid.setProp(button, "onMouseOut", () => {
    solid.setProp(button, "backgroundColor", theme.primary);
    solid.setProp(buttonLabel, "fg", theme.selectedListItemText);
  });
  solid.insert(button, buttonLabel);
  solid.insert(buttonRow, button);
  solid.insert(root, buttonRow);

  return root;
};

const materializeSidebar = (
  view: ActiveHooksView,
  theme: SidebarTheme,
  solid: SolidRuntime,
  onRowClick: (row: ActiveHookRow, theme: SidebarTheme) => void,
  onRowHover: () => void,
  interactive: boolean,
  notBefore: number,
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
      let hint: unknown;
      if (interactive) {
        hint = staticText(solid, OPEN_HINT, theme.textMuted);
        solid.setProp(hint, "flexShrink", 0);
        // Open on release: the host dialog backdrop dismisses on mouse-up, so
        // opening on mouse-down would close the popup with the same click.
        solid.setProp(line, "onMouseUp", () => onRowClick(row, theme));
        solid.setProp(line, "onMouseOver", () => {
          solid.setProp(line, "backgroundColor", theme.backgroundElement);
          solid.setProp(name, "fg", theme.primary);
          solid.setProp(hint, "fg", theme.primary);
          onRowHover();
        });
        solid.setProp(line, "onMouseOut", () => {
          solid.setProp(line, "backgroundColor", undefined);
          solid.setProp(name, "fg", theme.text);
          solid.setProp(hint, "fg", theme.textMuted);
          onRowHover();
        });
      }

      solid.insert(line, orb);
      solid.insert(line, name);
      solid.insert(line, label);
      if (hint !== undefined) solid.insert(line, hint);
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
    notBefore,
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
  readonly logFile?: string;
  readonly readSnapshot?: (file: string) => HookStatusReadResult;
  readonly readLatestLog?: (
    file: string,
    event: HookEventName,
    since?: number,
  ) => HookRunLogRecord | undefined;
  readonly pollMs?: number;
  readonly now?: () => number;
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
  const logFile = options.logFile ?? resolveHooksLogFile(directory);
  const readSnapshot = options.readSnapshot ?? readHookStatusSnapshot;
  const readLatestLog = options.readLatestLog ?? readLatestHookLog;
  const now = options.now ?? Date.now;
  const handles: SidebarRenderHandle[] = [];
  let statuses = new Map<string, HookRuntimeEntry>();
  let lastMtime: number | undefined;
  const sessionEpochs = new Map<string, number>();

  /**
   * A session's panel ignores every run it did not witness starting. This
   * keeps statuses from earlier sessions or a previous process from being
   * replayed as green when a session begins; the next fire re-lights the row.
   */
  const notBeforeFor = (sessionID: string | undefined): number => {
    const key = sessionID ?? "";
    const existing = sessionEpochs.get(key);
    if (existing !== undefined) return existing;
    const epoch = now();
    sessionEpochs.set(key, epoch);
    return epoch;
  };

  const applyToHandle = (
    handle: SidebarRenderHandle,
    next: ReadonlyMap<string, HookRunState>,
  ): boolean => {
    try {
      return applyStatuses(handle, next, solid);
    } catch {
      return false;
    }
  };

  const pollingEnabled = process.env.OWFLOW_HOOKS_DISABLED !== "1";

  const openHookLogPopup = (
    row: ActiveHookRow,
    theme: SidebarTheme,
    notBefore: number,
  ): void => {
    if (!pollingEnabled) return;
    let loaded: HookRunLogRecord | undefined;
    try {
      loaded = readLatestLog(logFile, row.event, notBefore);
    } catch {
      loaded = undefined;
    }
    const record = loaded;
    try {
      if (record === undefined) {
        api.ui.toast({
          variant: "info",
          title: "Hook logs",
          message: `No runs recorded for ${row.name} in this session yet.`,
        });
        return;
      }
      const onClose = (): void => api.ui.dialog.clear();
      const showLogs = (): void => {
        try {
          api.ui.dialog.replace(
            () =>
              api.ui.DialogAlert({
                title: `Hook logs: ${row.name}`,
                message: formatHookLogsMessage(record),
                onConfirm: () => api.ui.dialog.clear(),
              }),
            () => {},
          );
        } catch {
          // Keep the detail popup usable if the logs popup cannot open.
        }
      };
      api.ui.dialog.replace(
        () =>
          buildHookRunDetailBody(
            record,
            theme,
            solid,
            showLogs,
            onClose,
          ) as SolidElement,
        () => {},
      );
      // The host resets the dialog size to medium on every replace, so the
      // large size must be applied afterwards for the centered detail panel.
      api.ui.dialog.setSize(DETAIL_DIALOG_SIZE);
    } catch {
      // A click must never throw into the renderer; the panel stays usable.
    }
  };

  if (pollingEnabled) {
    const renderer = api.renderer;

    const tick = (): void => {
      let stat: fs.Stats | undefined;
      try {
        stat = fs.statSync(statusFile);
      } catch {
        lastMtime = undefined;
      }
      if (stat !== undefined) {
        if (!stat.isFile()) {
          lastMtime = undefined;
        } else if (lastMtime !== stat.mtimeMs) {
          lastMtime = stat.mtimeMs;
          const result = readSnapshot(statusFile);
          if (result.kind === "ok") {
            const next = new Map<string, HookRuntimeEntry>();
            for (const [event, runtime] of Object.entries(
              result.snapshot.hooks,
            )) {
              next.set(event, runtime);
            }
            statuses = next;
          }
        }
      }

      for (const handle of handles) {
        if (handle.disposed()) continue;
        const displayed = effectiveStatuses(statuses, handle.notBefore);
        if (applyToHandle(handle, displayed)) renderer.requestRender();
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
      [SIDEBAR_SLOT]: (ctx: SidebarSlotContext, props?: SidebarSlotProps) => {
        const notBefore = notBeforeFor(props?.session_id);
        const handle = materializeSidebar(
          view,
          ctx.theme.current,
          solid,
          (row, theme) => openHookLogPopup(row, theme, notBefore),
          () => api.renderer.requestRender(),
          pollingEnabled,
          notBefore,
        );
        applyToHandle(
          handle,
          effectiveStatuses(statuses, notBefore),
        );
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
