import fs from "node:fs";
import path from "node:path";
import type { TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui";
import {
  readHookStatusSnapshot,
  readLatestHookLog,
  resolveHooksLogFile,
  resolveHooksStatusFile,
  scanHooks,
} from "./hooks/user-hooks.js";
import {
  HookDigestMode,
  type HookEventName,
  type HookRunLogRecord,
  type HookRunState,
  type HookRuntimeEntry,
  type HookStatusReadResult,
} from "./types/hook-types.js";
import { hooksDirectory } from "./utils/workflow-paths.js";

const SIDEBAR_SLOT = "sidebar_content";
const ACTIVE_HOOKS_TITLE = "Active hooks:";
const EMPTY_HOOKS_NAME = "(none)";
const OPEN_HINT = "›";
const SHOW_LOGS_LABEL = "View logs";
const DETAIL_DIALOG_SIZE = "large";
const RUN_SUMMARY_MAX_CHARS = 4_000;
const DEFAULT_STATUS_POLL_MS = 200;

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

export interface ActiveHookRow {
  readonly name: string;
  readonly event: HookEventName;
}

export interface ActiveHooksView {
  readonly title: string;
  readonly rows: readonly ActiveHookRow[];
}

export const buildActiveHooksView = (directory: string): ActiveHooksView => {
  const scan = scanHooks(hooksDirectory(directory), { mode: HookDigestMode.Report });
  return {
    title: ACTIVE_HOOKS_TITLE,
    rows: scan.entries.map((entry) => ({
      name: path.basename(entry.path, path.extname(entry.path)),
      event: entry.event,
    })),
  };
};

export const statusLabelFor = (status: HookRunState | undefined): string =>
  status === "pending"
    ? "In progress"
    : status === "success"
      ? "Success"
      : status === "failure"
        ? "Error"
        : "Idle";

export const colorForStatus = (
  status: HookRunState | undefined,
  theme: SidebarTheme,
): unknown =>
  status === "pending"
    ? theme.warning
    : status === "success"
      ? theme.success
      : status === "failure"
        ? theme.error
        : theme.textMuted;

export const statusForDisplay = (
  entry: HookRuntimeEntry | undefined,
  notBefore = Number.NEGATIVE_INFINITY,
): HookRunState | undefined =>
  entry !== undefined && entry.startedAt >= notBefore ? entry.status : undefined;

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

export const formatHookRunSummary = (
  record: HookRunLogRecord,
  maxChars = RUN_SUMMARY_MAX_CHARS,
): string => {
  const lines = [
    `Event:  ${record.event}`,
    `Status: ${record.status === "success" ? "Success" : "Error"} — ${record.durationMs} ms`,
    `Time:   ${new Date(record.finishedAt).toISOString()}`,
    ...(record.sessionID !== undefined ? [`Session: ${record.sessionID}`] : []),
    ...(record.exitCode !== undefined ? [`Exit:   ${record.exitCode ?? "none"}`] : []),
    ...(record.signal ? [`Signal: ${record.signal}`] : []),
    ...(record.reason !== undefined ? ["", `Reason: ${record.reason}`] : []),
  ];
  return truncateMessage(lines.join("\n"), maxChars);
};

export const formatHookLogsMessage = (
  record: HookRunLogRecord,
  maxChars = Number.POSITIVE_INFINITY,
): string => {
  const sections: string[] = [];
  if (record.stderr !== undefined) sections.push(`--- stderr ---\n${record.stderr}`);
  if (record.stdout !== undefined) sections.push(`--- stdout ---\n${record.stdout}`);
  if (sections.length === 0) sections.push("No output captured for this run.");
  if (record.truncated === true) sections.push("[output truncated]");
  return truncateMessage(sections.join("\n\n"), maxChars);
};

export interface SidebarRenderHandle {
  readonly root: unknown;
  readonly rows: Map<string, { readonly orb: unknown; readonly label: unknown }>;
  readonly colors: Map<string, string>;
  readonly theme: SidebarTheme;
  readonly notBefore: number;
  disposed: () => boolean;
}

const el = (
  solid: SolidRuntime,
  tag: string,
  props: Record<string, unknown>,
  children: readonly unknown[] = [],
): unknown => {
  const node = solid.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v !== undefined) {
      try {
        solid.setProp(node, k, v);
      } catch {}
    }
  }
  for (const child of children) {
    if (child !== undefined) solid.insert(node, child);
  }
  return node;
};

const txt = (
  solid: SolidRuntime,
  content: string,
  fg: unknown,
  extra: Record<string, unknown> = {},
): unknown => el(solid, "text", { fg, content, ...extra });

const buildHeader = (
  solid: SolidRuntime,
  titleText: string,
  theme: SidebarTheme,
  onClose: () => void,
): unknown =>
  el(
    solid,
    "box",
    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%", gap: 1 },
    [
      txt(solid, titleText, theme.text, { flexGrow: 1, textAlign: "center" }),
      txt(solid, "esc", theme.textMuted, { flexShrink: 0, onMouseUp: onClose }),
    ],
  );

const buildHookLogsBody = (
  record: HookRunLogRecord,
  theme: SidebarTheme,
  solid: SolidRuntime,
  onClose: () => void,
  maxHeight: number,
): unknown =>
  el(
    solid,
    "box",
    { flexDirection: "column", width: "100%", paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1, gap: 1 },
    [
      buildHeader(solid, `Hook logs: ${record.name}`, theme, onClose),
      el(
        solid,
        "scrollbox",
        { flexGrow: 1, width: "100%", maxHeight, focused: true },
        [txt(solid, formatHookLogsMessage(record), theme.text, { width: "100%" })],
      ),
    ],
  );

const buildHookRunDetailBody = (
  record: HookRunLogRecord,
  logFile: string,
  theme: SidebarTheme,
  solid: SolidRuntime,
  onShowLogs: () => void,
  onClose: () => void,
): unknown => {
  const button = solid.createElement("box");
  const buttonLabel = txt(solid, SHOW_LOGS_LABEL, theme.selectedListItemText, { flexShrink: 0 });
  for (const [k, v] of Object.entries({
    backgroundColor: theme.primary,
    paddingLeft: 3,
    paddingRight: 3,
    onMouseUp: onShowLogs,
    onMouseOver: () => {
      solid.setProp(button, "backgroundColor", theme.backgroundElement);
      solid.setProp(buttonLabel, "fg", theme.primary);
    },
    onMouseOut: () => {
      solid.setProp(button, "backgroundColor", theme.primary);
      solid.setProp(buttonLabel, "fg", theme.selectedListItemText);
    },
  })) {
    solid.setProp(button, k, v);
  }
  solid.insert(button, buttonLabel);

  return el(
    solid,
    "box",
    {
      flexDirection: "column",
      alignItems: "center",
      width: "100%",
      paddingLeft: 2,
      paddingRight: 2,
      paddingTop: 1,
      paddingBottom: 1,
      gap: 1,
    },
    [
      buildHeader(solid, `Hook run: ${record.name}`, theme, onClose),
      txt(solid, formatHookRunSummary(record), theme.textMuted, { width: "100%", textAlign: "center" }),
      txt(solid, `Log file: ${logFile}`, theme.textMuted, { width: "100%", textAlign: "center" }),
      el(solid, "box", { flexDirection: "row", justifyContent: "center", width: "100%" }, [button]),
    ],
  );
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
  const rows = new Map<string, { readonly orb: unknown; readonly label: unknown }>();
  const colors = new Map<string, string>();
  const root = el(solid, "box", { flexDirection: "column" }, [
    el(solid, "text", { fg: theme.text }, [view.title]),
  ]);

  if (view.rows.length === 0) {
    solid.insert(root, txt(solid, EMPTY_HOOKS_NAME, theme.textMuted));
  } else {
    for (const row of view.rows) {
      const line = el(solid, "box", { flexDirection: "row", gap: 1 });
      const orb = txt(solid, "•", colorForStatus(undefined, theme), { flexShrink: 0 });
      const name = txt(solid, row.name, theme.text);
      const label = txt(solid, statusLabelFor(undefined), theme.textMuted);
      let hint: unknown;
      if (interactive) {
        hint = txt(solid, OPEN_HINT, theme.textMuted, { flexShrink: 0 });
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
      for (const child of [orb, name, label, hint]) {
        if (child !== undefined) solid.insert(line, child);
      }
      solid.insert(root, line);
      rows.set(row.event, { orb, label });
      colors.set(row.event, "idle");
    }
  }

  return {
    root,
    rows,
    colors,
    theme,
    notBefore,
    disposed: () => Boolean((root as { isDestroyed?: unknown } | null)?.isDestroyed),
  };
};

const loadSolidRuntime = async (): Promise<SolidRuntime | null> => {
  try {
    const runtime = (await import("@opentui/solid")) as Partial<SolidRuntime>;
    return typeof runtime.createElement === "function" &&
      typeof runtime.insert === "function" &&
      typeof runtime.setProp === "function"
      ? (runtime as SolidRuntime)
      : null;
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

export const registerActiveHooksSidebar = async (
  api: TuiPluginApi,
  directory: string,
  loadSolid: () => Promise<SolidRuntime | null> = loadSolidRuntime,
  options: ActiveHooksSidebarOptions = {},
): Promise<boolean> => {
  const solid = await loadSolid();
  if (solid === null) {
    console.warn("[owflow] TUI Solid runtime unavailable; cannot render the active hooks panel.");
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

  const applyToHandle = (
    handle: SidebarRenderHandle,
    next: ReadonlyMap<string, HookRunState>,
  ): boolean => {
    try {
      let changed = false;
      for (const [event, nodes] of handle.rows) {
        const status = next.get(event);
        const key = status ?? "idle";
        if (handle.colors.get(event) === key) continue;
        solid.setProp(nodes.orb, "fg", colorForStatus(status, handle.theme));
        solid.setProp(nodes.label, "content", statusLabelFor(status));
        handle.colors.set(event, key);
        changed = true;
      }
      return changed;
    } catch {
      return false;
    }
  };

  const pollingEnabled = process.env.OWFLOW_HOOKS_DISABLED !== "1";

  const openHookLogPopup = (row: ActiveHookRow, theme: SidebarTheme, notBefore: number): void => {
    if (!pollingEnabled) return;
    let record: HookRunLogRecord | undefined;
    try {
      record = readLatestLog(logFile, row.event, notBefore);
    } catch {}
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
          const h = api.renderer.height;
          const maxHeight = Math.max(4, Math.floor(((h > 0 ? h : 24) * 3) / 4) - 8);
          api.ui.dialog.replace(
            () => buildHookLogsBody(record, theme, solid, onClose, maxHeight) as SolidElement,
            () => {},
          );
          api.ui.dialog.setSize(DETAIL_DIALOG_SIZE);
        } catch {}
      };
      api.ui.dialog.replace(
        () => buildHookRunDetailBody(record, logFile, theme, solid, showLogs, onClose) as SolidElement,
        () => {},
      );
      api.ui.dialog.setSize(DETAIL_DIALOG_SIZE);
    } catch {}
  };

  if (pollingEnabled) {
    const renderer = api.renderer;
    const tick = (): void => {
      try {
        const stat = fs.statSync(statusFile);
        if (stat.isFile() && lastMtime !== stat.mtimeMs) {
          lastMtime = stat.mtimeMs;
          const result = readSnapshot(statusFile);
          if (result.kind === "ok") {
            statuses = new Map(Object.entries(result.snapshot.hooks));
          }
        } else if (!stat.isFile()) {
          lastMtime = undefined;
        }
      } catch {
        lastMtime = undefined;
      }

      for (const handle of handles) {
        if (handle.disposed()) continue;
        if (applyToHandle(handle, effectiveStatuses(statuses, handle.notBefore))) {
          renderer.requestRender();
        }
      }
      for (let i = handles.length - 1; i >= 0; i -= 1) {
        if (handles[i]!.disposed()) handles.splice(i, 1);
      }
    };

    const timer = setInterval(tick, options.pollMs ?? DEFAULT_STATUS_POLL_MS);
    (timer as { unref?: () => void }).unref?.();
    api.lifecycle.onDispose(() => clearInterval(timer));
  }

  api.slots.register({
    order: 50,
    slots: {
      [SIDEBAR_SLOT]: (
        ctx: { readonly theme: { readonly current: SidebarTheme } },
        props?: { readonly session_id?: string },
      ) => {
        const key = props?.session_id ?? "";
        const notBefore = sessionEpochs.get(key) ?? (sessionEpochs.set(key, now()), sessionEpochs.get(key)!);
        const handle = materializeSidebar(
          view,
          ctx.theme.current,
          solid,
          (row, theme) => openHookLogPopup(row, theme, notBefore),
          () => api.renderer.requestRender(),
          pollingEnabled,
          notBefore,
        );
        applyToHandle(handle, effectiveStatuses(statuses, notBefore));
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
    console.warn("[owflow] workspace directory unavailable; cannot render the active hooks panel.");
    return;
  }
  await registerActiveHooksSidebar(api, directory);
};

export default { id: "owflow", tui } satisfies TuiPluginModule;
