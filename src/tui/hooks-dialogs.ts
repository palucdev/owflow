import type { TuiPluginApi } from '@opencode-ai/plugin/tui';
import type { EventName, HookRuntimeEntry } from '../types/hook-types.js';
import type { ActiveHookRow } from './hooks-presenter.js';
import type { SidebarTheme, SolidElement, SolidRuntime } from './primitives.js';
import { buildHookLogsBody, buildHookRunDetailBody } from './hooks-dialogs-bodies.js';
import { createIdleRecord, resolveSessionRecords } from './hooks-dialogs-records.js';

const DETAIL_DIALOG_SIZE = 'large';

const MIN_LOGS_HEIGHT = 4;
const DEFAULT_TERMINAL_HEIGHT = 24;
const HEIGHT_SCALE_NUMERATOR = 3;
const HEIGHT_SCALE_DENOMINATOR = 4;
const HEIGHT_OFFSET = 8;

export interface ActiveDialogHandle {
  readonly event: EventName;
  readonly row: ActiveHookRow;
  readonly notBefore: number;
  readonly sessionID?: string;
  readonly dispose: () => void;
}

class DialogStateManager {
  private activeHandle: ActiveDialogHandle | undefined;

  getHandle(): ActiveDialogHandle | undefined {
    return this.activeHandle;
  }

  setHandle(handle: ActiveDialogHandle | undefined): void {
    this.activeHandle = handle;
  }
}

export const dialogStateManager = new DialogStateManager();
export const getActiveDialogHandle = (): ActiveDialogHandle | undefined => dialogStateManager.getHandle();

export interface OpenHookLogPopupOptions {
  readonly api: TuiPluginApi;
  readonly solid: SolidRuntime;
  readonly logFile: string;
  readonly row: ActiveHookRow;
  readonly theme: SidebarTheme;
  readonly notBefore: number;
  readonly sessionID?: string;
  readonly statusFile?: string;
  readonly fallbackEntry?: HookRuntimeEntry;
}

const calculateMaxHeight = (rendererHeight: number): number => {
  const effectiveHeight = rendererHeight > 0 ? rendererHeight : DEFAULT_TERMINAL_HEIGHT;
  const scaledHeight = Math.floor((effectiveHeight * HEIGHT_SCALE_NUMERATOR) / HEIGHT_SCALE_DENOMINATOR);
  return Math.max(MIN_LOGS_HEIGHT, scaledHeight - HEIGHT_OFFSET);
};

interface HandleOptions {
  readonly notBefore: number;
  readonly sessionID?: string;
}

const createDialogHandle = (row: ActiveHookRow, options: HandleOptions): ActiveDialogHandle => {
  const { notBefore, sessionID } = options;
  const handle: ActiveDialogHandle = {
    event: row.event,
    row,
    notBefore,
    ...(sessionID !== undefined && { sessionID }),
    dispose: () => {
      if (dialogStateManager.getHandle() === handle) {
        dialogStateManager.setHandle(undefined);
      }
    },
  };
  return handle;
};

export const openHookLogPopup = (options: OpenHookLogPopupOptions): void => {
  const { api, solid, logFile, row, theme, notBefore, sessionID, statusFile, fallbackEntry } = options;

  dialogStateManager.getHandle()?.dispose();
  const records = resolveSessionRecords({ logFile, row, notBefore, sessionID, statusFile, fallbackEntry });

  try {
    const targetRecord = records.at(-1) ?? createIdleRecord(row, sessionID);
    const maxHeight = calculateMaxHeight(api.renderer.height);
    const onClose = (): void => {
      dialogStateManager.getHandle()?.dispose();
      api.ui.dialog.clear();
    };

    const dialogUi = api.ui.dialog;
    const showLogs = (): void => {
      try {
        dialogStateManager.getHandle()?.dispose();
        const latestRecords = resolveSessionRecords({ logFile, row, notBefore, sessionID, statusFile, fallbackEntry });
        const effectiveRecord = latestRecords.at(-1) ?? targetRecord;
        const logsHandle = createDialogHandle(row, { notBefore, sessionID });
        dialogStateManager.setHandle(logsHandle);
        dialogUi['replace'](() => {
          const logsBody = buildHookLogsBody({ record: effectiveRecord, theme, solid, onClose, maxHeight });
          return logsBody as SolidElement;
        }, logsHandle.dispose);
        dialogUi.setSize(DETAIL_DIALOG_SIZE);
      } catch {
        // ignore showLogs dialog replacement error
      }
    };

    const detailHandle = createDialogHandle(row, { notBefore, sessionID });
    dialogStateManager.setHandle(detailHandle);
    dialogUi['replace'](() => {
      const detailBody = buildHookRunDetailBody({
        record: targetRecord,
        logFile,
        theme,
        solid,
        onShowLogs: showLogs,
        onClose,
        totalRunsInSession: records.length,
      });
      return detailBody as SolidElement;
    }, detailHandle.dispose);
    dialogUi.setSize(DETAIL_DIALOG_SIZE);
  } catch {
    // ignore popup open error
  }
};
