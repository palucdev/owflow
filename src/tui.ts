import fs from 'node:fs';
import type { TuiPluginApi, TuiPluginModule } from '@opencode-ai/plugin/tui';
import {
  readHookStatusSnapshot,
  readSessionHookLogs,
  readSessionLatestLogs,
  resolveHooksLogFile,
  resolveHooksStatusFile,
} from './hooks/hook-logs.js';
import type { HookEventName, HookRunLogRecord, HookRunState, HookRuntimeEntry, HookStatusReadResult } from './types/hook-types.js';
import { DEFAULT_LOG_CHUNK_LINES, buildHookLogsBody, buildHookRunDetailBody, openHookLogPopup } from './tui/hook-dialogs.js';
import {
  buildActiveHooksView,
  colorForStatus,
  formatHookLogsMessage,
  formatHookRunSummary,
  formatSessionHookLogsMessage,
  statusLabelFor,
  type ActiveHookRow,
  type ActiveHooksView,
} from './tui/hook-formatting.js';
import { materializeSidebar, type SidebarRenderHandle } from './tui/hooks-sidebar.js';
import { loadSolidRuntime, type SidebarTheme, type SolidRuntime } from './tui/primitives.js';

export {
  DEFAULT_LOG_CHUNK_LINES,
  buildActiveHooksView,
  buildHookLogsBody,
  buildHookRunDetailBody,
  colorForStatus,
  formatHookLogsMessage,
  formatHookRunSummary,
  formatSessionHookLogsMessage,
  statusLabelFor,
  type ActiveHookRow,
  type ActiveHooksView,
  type SidebarRenderHandle,
  type SidebarTheme,
  type SolidRuntime,
};

const SIDEBAR_SLOT = 'sidebar_content';
const DEFAULT_STATUS_POLL_MS = 200;

export interface ActiveHooksSidebarOptions {
  readonly statusFile?: string;
  readonly logFile?: string;
  readonly readSnapshot?: (file: string) => HookStatusReadResult;
  readonly readSessionLogs?: (file: string, sessionID: string) => Map<string, HookRunLogRecord>;
  readonly readSessionHookLogs?: (file: string, event: HookEventName, since?: number, sessionID?: string) => readonly HookRunLogRecord[];
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
    console.warn('[owflow] TUI Solid runtime unavailable; cannot render the active hooks panel.');
    return false;
  }

  const view = buildActiveHooksView(directory);
  const statusFile = options.statusFile ?? resolveHooksStatusFile(directory);
  const logFile = options.logFile ?? resolveHooksLogFile(directory);
  const readSnapshot = options.readSnapshot ?? readHookStatusSnapshot;
  const readSessionLogs = options.readSessionLogs ?? readSessionLatestLogs;
  const readSessionLogsList = options.readSessionHookLogs ?? readSessionHookLogs;
  const now = options.now ?? Date.now;
  const handles: SidebarRenderHandle[] = [];
  let statuses = new Map<string, HookRuntimeEntry>();
  let lastMtime: number | undefined;
  const sessionEpochs = new Map<string, number>();
  const pollingEnabled = process.env.OWFLOW_HOOKS_DISABLED !== '1';

  if (pollingEnabled) {
    const renderer = api.renderer;
    const tick = (): void => {
      try {
        const stat = fs.statSync(statusFile);
        if (stat.isFile() && lastMtime !== stat.mtimeMs) {
          lastMtime = stat.mtimeMs;
          const result = readSnapshot(statusFile);
          if (result.kind === 'ok') {
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
        if (handle.applyStatuses(statuses)) {
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
      [SIDEBAR_SLOT]: (ctx: { readonly theme: { readonly current: SidebarTheme } }, props?: { readonly session_id?: string }) => {
        const sessionID = props?.session_id;
        const key = sessionID ?? '';
        const notBefore = sessionEpochs.get(key) ?? (sessionEpochs.set(key, now()), sessionEpochs.get(key)!);
        const initialStates = new Map<string, HookRunState>();
        if (sessionID !== undefined && sessionID.length > 0) {
          try {
            const sessionLogs = readSessionLogs(logFile, sessionID);
            for (const [event, rec] of sessionLogs) {
              initialStates.set(event, rec.status);
            }
          } catch {}
        }
        const handle = materializeSidebar(
          view,
          ctx.theme.current,
          solid,
          (row, theme) => {
            if (pollingEnabled) {
              openHookLogPopup(api, solid, logFile, readSessionLogsList, row, theme, notBefore, sessionID);
            }
          },
          () => api.renderer.requestRender(),
          pollingEnabled,
          notBefore,
          sessionID,
          initialStates,
        );
        handle.applyStatuses(statuses);
        handles.push(handle);
        return handle.root;
      },
    },
  });
  return true;
};

const tui = async (api: TuiPluginApi): Promise<void> => {
  const directory = api.state.path.directory;
  if (typeof directory !== 'string' || directory.length === 0) {
    console.warn('[owflow] workspace directory unavailable; cannot render the active hooks panel.');
    return;
  }
  await registerActiveHooksSidebar(api, directory);
};

export default { id: 'owflow', tui } satisfies TuiPluginModule;
