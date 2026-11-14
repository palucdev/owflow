import type { TuiPluginApi, TuiPluginModule } from '@opencode-ai/plugin/tui';
import { readSessionLatestLogs, resolveHooksLogFile, resolveHooksStatusFile } from './hooks/hooks-persistence.js';
import type { HookRunState, HookRuntimeEntry } from './types/hook-types.js';
import { getActiveDialogHandle, openHookLogPopup } from './tui/hooks-dialogs.js';
import { setupStatusPolling } from './tui/hooks-polling.js';
import { buildActiveHooksView, type ActiveHookRow, type ActiveHooksView } from './tui/hooks-presenter.js';
import { materializeSidebar, type SidebarRenderHandle } from './tui/hooks-sidebar.js';
import { loadSolidRuntime, type SidebarTheme, type SolidRuntime } from './tui/primitives.js';
import { createDefaultEnvironmentConfig, type EnvironmentConfig } from './utils/environment-config.js';

export {
  buildActiveHooksView,
  colorForStatus,
  formatHookLogsMessage,
  formatHookRunSummary,
  statusLabelFor,
  type ActiveHookRow,
  type ActiveHooksView,
} from './tui/hooks-presenter.js';
export {
  buildHookLogsBody,
  buildHookRunDetailBody,
  getActiveDialogHandle,
  type ActiveDialogHandle,
} from './tui/hooks-dialogs.js';
export {
  materializeSidebar,
  type SidebarRenderHandle,
} from './tui/hooks-sidebar.js';
export {
  type SidebarTheme,
  type SolidRuntime,
} from './tui/primitives.js';

const SIDEBAR_SLOT = 'sidebar_content';

interface SessionStateOptions {
  readonly sessionID: string;
  readonly rows: readonly ActiveHookRow[];
}

const loadInitialSessionStates = (
  directory: string,
  options: SessionStateOptions,
): Map<string, HookRunState> => {
  const initialStates = new Map<string, HookRunState>();
  if (!options.sessionID) {
    return initialStates;
  }
  for (const row of options.rows) {
    try {
      const rowLogFile = resolveHooksLogFile(directory, row.name);
      const sessionLogs = readSessionLatestLogs(rowLogFile, options.sessionID);
      const rec = sessionLogs.get(row.event);
      if (rec) {
        initialStates.set(row.event, rec.status);
      }
    } catch {
      // ignore log read error
    }
  }
  return initialStates;
};

interface SlotHandlerContext {
  readonly api: TuiPluginApi;
  readonly solid: SolidRuntime;
  readonly directory: string;
  readonly view: ActiveHooksView;
  readonly statusFile: string;
  readonly isPollingEnabled: boolean;
  readonly handles: SidebarRenderHandle[];
  readonly statusContainer: { current: Map<string, HookRuntimeEntry> };
  readonly sessionEpochs: Map<string, number>;
}

const resolveSessionEpoch = (sessionEpochs: Map<string, number>, sessionID = ''): number => {
  const existing = sessionEpochs.get(sessionID);
  if (existing !== undefined) {
    return existing;
  }
  const now = Date.now();
  sessionEpochs.set(sessionID, now);
  return now;
};

const setupCleanupHandler = (
  solid: SolidRuntime,
  context: { readonly handles: SidebarRenderHandle[]; readonly handle: SidebarRenderHandle },
): void => {
  if (typeof solid.onCleanup === 'function') {
    try {
      solid.onCleanup(() => {
        context.handle.dispose();
        const handleIndex = context.handles.indexOf(context.handle);
        if (handleIndex !== -1) {
          context.handles.splice(handleIndex, 1);
        }
      });
    } catch {
      // ignore onCleanup error
    }
  }
};

const renderSlotHandle = (
  context: SlotHandlerContext,
  renderOptions: { readonly theme: SidebarTheme; readonly sessionID?: string },
): unknown => {
  const { api, solid, directory, view, statusFile, isPollingEnabled, handles, statusContainer } = context;
  const { theme, sessionID } = renderOptions;
  const notBefore = resolveSessionEpoch(context.sessionEpochs, sessionID);
  const initialStates = loadInitialSessionStates(directory, { sessionID: sessionID ?? '', rows: view.rows });

  const handle = materializeSidebar(
    view,
    theme,
    solid,
    (row: ActiveHookRow, rowTheme: SidebarTheme) => {
      if (!isPollingEnabled) {
        return;
      }
      const rowLogFile = resolveHooksLogFile(directory, row.name);
      openHookLogPopup(
        api,
        solid,
        rowLogFile,
        row,
        rowTheme,
        notBefore,
        sessionID,
        statusFile,
        statusContainer.current.get(row.event),
      );
    },
    () => api.renderer.requestRender(),
    isPollingEnabled,
    notBefore,
    sessionID,
    initialStates,
  );

  handle.applyStatuses(statusContainer.current);
  handles.push(handle);
  setupCleanupHandler(solid, { handles, handle });
  return handle.root;
};

interface SlotRegistrationOptions {
  readonly api: TuiPluginApi;
  readonly solid: SolidRuntime;
  readonly directory: string;
  readonly view: ActiveHooksView;
  readonly statusFile: string;
  readonly isPollingEnabled: boolean;
  readonly handles: SidebarRenderHandle[];
  readonly statusContainer: { current: Map<string, HookRuntimeEntry> };
}

const registerSidebarSlot = (options: SlotRegistrationOptions): void => {
  const sessionEpochs = new Map<string, number>();
  const context: SlotHandlerContext = { ...options, sessionEpochs };

  options.api.slots.register({
    order: 50,
    slots: {
      [SIDEBAR_SLOT]: (
        slotContext: { readonly theme: { readonly current: SidebarTheme } },
        slotProperties?: { readonly session_id?: string },
      ) => renderSlotHandle(context, { theme: slotContext.theme.current, sessionID: slotProperties?.session_id }),
    },
  });
};

export interface RegisterSidebarOptions {
  readonly api: TuiPluginApi;
  readonly directory: string;
  readonly loadSolid?: () => Promise<SolidRuntime | null>;
  readonly config?: EnvironmentConfig;
}

const resolveRegisterOptions = (
  apiOrOptions: TuiPluginApi | RegisterSidebarOptions,
  rest: readonly unknown[],
): RegisterSidebarOptions => {
  if ('api' in apiOrOptions) {
    return apiOrOptions;
  }
  const directory = typeof rest[0] === 'string' ? rest[0] : '';
  const loadSolid = typeof rest[1] === 'function' ? (rest[1] as () => Promise<SolidRuntime | null>) : loadSolidRuntime;
  const config = rest[2] as EnvironmentConfig | undefined;
  return { api: apiOrOptions, directory, loadSolid, config };
};

export const hasRegisteredActiveHooksSidebar = async (
  apiOrOptions: TuiPluginApi | RegisterSidebarOptions,
  ...rest: readonly unknown[]
): Promise<boolean> => {
  const { api, directory, loadSolid = loadSolidRuntime, config = createDefaultEnvironmentConfig() } =
    resolveRegisterOptions(apiOrOptions, rest);

  const solid = await loadSolid();
  if (solid === null) {
    console.warn('[owflow] TUI Solid runtime unavailable; cannot render the active hooks panel.');
    return false;
  }

  const view = buildActiveHooksView(directory);
  const statusFile = resolveHooksStatusFile(directory, config);
  const handles: SidebarRenderHandle[] = [];
  const statusContainer = { current: new Map<string, HookRuntimeEntry>() };
  const isPollingEnabled = !config.isHooksDisabled;

  if (isPollingEnabled) {
    setupStatusPolling({ api, statusFile, handles, statusContainer });
  } else {
    api.lifecycle.onDispose(() => {
      getActiveDialogHandle()?.dispose();
      for (const handle of handles) {
        handle.dispose();
      }
      handles.length = 0;
    });
  }

  registerSidebarSlot({ api, solid, directory, view, statusFile, isPollingEnabled, handles, statusContainer });
  return true;
};

export { hasRegisteredActiveHooksSidebar as registerActiveHooksSidebar };

const tui = async (api: TuiPluginApi): Promise<void> => {
  const directory = api.state.path.directory;
  if (typeof directory !== 'string' || directory.length === 0) {
    console.warn('[owflow] workspace directory unavailable; cannot render the active hooks panel.');
    return;
  }
  await hasRegisteredActiveHooksSidebar(api, directory);
};

export default { id: 'owflow', tui } satisfies TuiPluginModule;
