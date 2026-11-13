import type { TuiPluginApi } from '@opencode-ai/plugin/tui';
import { HookEvent, HookRunState, type HookEventName, type HookRunLogRecord, type HookRuntimeEntry } from '../types/hook-types.js';
import { formatHookLogsMessage, formatHookRunSummary, type ActiveHookRow } from './hooks-presenter.js';
import { el, txt, type SidebarTheme, type SolidElement, type SolidRuntime } from './primitives.js';
import { readHookStatusSnapshot, readSessionHookLogs } from '../hooks/hooks-persistence.js';

const SHOW_LOGS_LABEL = 'View logs';
const DETAIL_DIALOG_SIZE = 'large';

export interface ActiveDialogHandle {
  readonly event: HookEventName;
  readonly row: ActiveHookRow;
  readonly notBefore: number;
  readonly sessionID?: string;
  readonly dispose: () => void;
}

let currentDialogHandle: ActiveDialogHandle | undefined;

export const getActiveDialogHandle = (): ActiveDialogHandle | undefined => currentDialogHandle;

const buildHeader = (solid: SolidRuntime, titleText: string, theme: SidebarTheme, onClose: () => void): unknown =>
  el(solid, 'box', { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 1 }, [
    txt(solid, titleText, theme.text, { flexGrow: 1, textAlign: 'center' }),
    txt(solid, 'esc', theme.textMuted, { flexShrink: 0, onMouseUp: onClose }),
  ]);

export const buildHookLogsBody = (
  record: HookRunLogRecord,
  theme: SidebarTheme,
  solid: SolidRuntime,
  onClose: () => void,
  maxHeight: number,
  _renderer?: { requestRender: () => void },
): unknown => {
  const fullText = formatHookLogsMessage(record);
  const bodyNode = txt(solid, fullText, theme.text, { width: '100%', textAlign: 'left' });
  const scrollbox = el(solid, 'scrollbox', { width: '100%', height: maxHeight, focused: true }, [bodyNode]);

  return el(
    solid,
    'box',
    {
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      paddingLeft: 2,
      paddingRight: 2,
      paddingTop: 1,
      paddingBottom: 1,
      gap: 1,
    },
    [buildHeader(solid, `Hook logs: ${record.name}`, theme, onClose), scrollbox],
  );
};

export const buildHookRunDetailBody = (
  record: HookRunLogRecord,
  logFile: string,
  theme: SidebarTheme,
  solid: SolidRuntime,
  onShowLogs: () => void,
  onClose: () => void,
  totalRunsInSession = 0,
  _renderer?: { requestRender: () => void },
): unknown => {
  const buttonLabel = txt(solid, SHOW_LOGS_LABEL, theme.selectedListItemText, { flexShrink: 0 });
  const button: unknown = el(
    solid,
    'box',
    {
      backgroundColor: theme.primary,
      paddingLeft: 3,
      paddingRight: 3,
      alignItems: 'center',
      justifyContent: 'center',
      onMouseUp: onShowLogs,
      onMouseOver: () => {
        solid.setProp(button, 'backgroundColor', theme.backgroundElement);
        solid.setProp(buttonLabel, 'fg', theme.primary);
      },
      onMouseOut: () => {
        solid.setProp(button, 'backgroundColor', theme.primary);
        solid.setProp(buttonLabel, 'fg', theme.selectedListItemText);
      },
    },
    [buttonLabel],
  );

  const formatDetails = (rec: HookRunLogRecord, totalRuns: number): string =>
    [formatHookRunSummary(rec), `Runs in session: ${totalRuns}`, `Log file: ${logFile}`].join('\n');

  const detailsText = formatDetails(record, totalRunsInSession);
  const detailsNode = txt(solid, detailsText, theme.textMuted, { width: '100%', textAlign: 'center' });

  return el(
    solid,
    'box',
    {
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      paddingLeft: 2,
      paddingRight: 2,
      paddingTop: 1,
      paddingBottom: 1,
      gap: 1,
    },
    [
      buildHeader(solid, `Hook run: ${record.name}`, theme, onClose),
      detailsNode,
      el(solid, 'box', { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', width: '100%' }, [button]),
    ],
  );
};

const createIdleRecord = (row: ActiveHookRow, sessionID?: string): HookRunLogRecord => ({
  version: 1,
  runId: `${row.event}#idle`,
  pid: process.pid,
  workspace: '',
  event: row.event,
  hook: row.name,
  name: row.name,
  ...(sessionID !== undefined ? { sessionID } : {}),
  startedAt: 0,
  finishedAt: 0,
  durationMs: 0,
  status: HookRunState.IDLE,
});

export const resolveSessionRecords = (
  logFile: string,
  row: ActiveHookRow,
  notBefore: number,
  sessionID?: string,
  statusFile?: string,
  fallbackEntry?: HookRuntimeEntry,
): readonly HookRunLogRecord[] => {
  let records: readonly HookRunLogRecord[] = [];
  try {
    records = readSessionHookLogs(logFile, row.event, notBefore, sessionID);
  } catch {}

  let entry = fallbackEntry;
  if (statusFile) {
    try {
      const snap = readHookStatusSnapshot(statusFile);
      if (snap.kind === 'ok' && snap.snapshot.hooks[row.event]) {
        entry = snap.snapshot.hooks[row.event];
      }
    } catch {}
  }

  if (entry && entry.status !== HookRunState.IDLE) {
    const belongs = sessionID && entry.sessionID ? entry.sessionID === sessionID : true;
    const lastRecord = records[records.length - 1];
    const shouldAppend =
      entry.status === HookRunState.PENDING
        ? lastRecord?.status !== HookRunState.PENDING
        : lastRecord === undefined || lastRecord.startedAt < entry.startedAt;
    if (belongs && shouldAppend) {
      const now = Date.now();
      const exitCode = (entry as { readonly exitCode?: number | null }).exitCode;
      const runtimeRecord: HookRunLogRecord = {
        version: 1,
        runId: `${row.event}#${entry.status}`,
        pid: process.pid,
        workspace: '',
        event: row.event,
        hook: row.name,
        name: row.name,
        ...(entry.sessionID !== undefined ? { sessionID: entry.sessionID } : sessionID !== undefined ? { sessionID } : {}),
        startedAt: entry.startedAt,
        finishedAt: entry.finishedAt ?? now,
        durationMs: entry.durationMs ?? Math.max(0, (entry.finishedAt ?? now) - entry.startedAt),
        status: entry.status,
        ...(exitCode !== undefined ? { exitCode } : {}),
        ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
      };
      records = [...records, runtimeRecord];
    }
  }

  return records;
};

export const openHookLogPopup = (
  api: TuiPluginApi,
  solid: SolidRuntime,
  logFile: string,
  row: ActiveHookRow,
  theme: SidebarTheme,
  notBefore: number,
  sessionID?: string,
  statusFile?: string,
  fallbackEntry?: HookRuntimeEntry,
): void => {
  currentDialogHandle?.dispose();
  const records = resolveSessionRecords(logFile, row, notBefore, sessionID, statusFile, fallbackEntry);
  try {
    const targetRecord = records[records.length - 1] ?? createIdleRecord(row, sessionID);
    const h = api.renderer.height;
    const maxHeight = Math.max(4, Math.floor(((h > 0 ? h : 24) * 3) / 4) - 8);
    const onClose = (): void => {
      currentDialogHandle?.dispose();
      api.ui.dialog.clear();
    };
    const showLogs = (): void => {
      try {
        currentDialogHandle?.dispose();
        const latestRecords = resolveSessionRecords(logFile, row, notBefore, sessionID, statusFile, fallbackEntry);
        const effective = latestRecords[latestRecords.length - 1] ?? targetRecord;
        const logsHandle: ActiveDialogHandle = {
          event: row.event,
          row,
          notBefore,
          ...(sessionID !== undefined ? { sessionID } : {}),
          dispose: () => {
            if (currentDialogHandle === logsHandle) {
              currentDialogHandle = undefined;
            }
          },
        };
        currentDialogHandle = logsHandle;
        api.ui.dialog.replace(() => {
          const logsBody = buildHookLogsBody(effective, theme, solid, onClose, maxHeight, api.renderer);
          return logsBody as SolidElement;
        }, logsHandle.dispose);
        api.ui.dialog.setSize(DETAIL_DIALOG_SIZE);
      } catch {}
    };

    const detailHandle: ActiveDialogHandle = {
      event: row.event,
      row,
      notBefore,
      ...(sessionID !== undefined ? { sessionID } : {}),
      dispose: () => {
        if (currentDialogHandle === detailHandle) {
          currentDialogHandle = undefined;
        }
      },
    };
    currentDialogHandle = detailHandle;
    api.ui.dialog.replace(() => {
      const detailBody = buildHookRunDetailBody(targetRecord, logFile, theme, solid, showLogs, onClose, records.length, api.renderer);
      return detailBody as SolidElement;
    }, detailHandle.dispose);
    api.ui.dialog.setSize(DETAIL_DIALOG_SIZE);
  } catch {}
};
