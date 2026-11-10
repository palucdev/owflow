import type { TuiPluginApi } from '@opencode-ai/plugin/tui';
import { HookRunState, type HookEventName, type HookRunLogRecord, type HookRuntimeEntry } from '../types/hook-types.js';
import { formatHookLogsMessage, formatHookRunSummary, type ActiveHookRow } from './hooks-presenter.js';
import { el, txt, type SidebarTheme, type SolidElement, type SolidRuntime } from './primitives.js';
import { readHookStatusSnapshot, readHookStreamLogs, readSessionHookLogs } from '../hooks/hooks-persistence.js';

const SHOW_LOGS_LABEL = 'View logs';
const DETAIL_DIALOG_SIZE = 'large';
export const DEFAULT_LOG_CHUNK_LINES = 100;

export interface ActiveDialogHandle {
  readonly event: HookEventName;
  readonly row: ActiveHookRow;
  readonly notBefore: number;
  readonly sessionID?: string;
  readonly update: (records: readonly HookRunLogRecord[]) => boolean;
  readonly dispose: () => void;
}

let currentDialogHandle: ActiveDialogHandle | undefined;

export const getActiveDialogHandle = (): ActiveDialogHandle | undefined => currentDialogHandle;

const buildHeader = (solid: SolidRuntime, titleText: string, theme: SidebarTheme, onClose: () => void): unknown =>
  el(solid, 'box', { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 1 }, [
    txt(solid, titleText, theme.text, { flexGrow: 1, textAlign: 'center' }),
    txt(solid, 'esc', theme.textMuted, { flexShrink: 0, onMouseUp: onClose }),
  ]);

const buildScrollableTextBox = (
  fullText: string,
  fg: unknown,
  theme: SidebarTheme,
  solid: SolidRuntime,
  maxHeight: number,
  renderer?: { requestRender: () => void },
  chunkLines = DEFAULT_LOG_CHUNK_LINES,
): unknown => {
  let currentFullText = fullText;
  let allLines = currentFullText.split('\n');
  let totalLines = allLines.length;
  let loadedLines = Math.min(totalLines, chunkLines);

  const getVisibleText = (): string => allLines.slice(0, loadedLines).join('\n');
  const getFooterText = (): string => (loadedLines < totalLines ? `[scroll for more logs: ${loadedLines}/${totalLines} lines loaded]` : '');
  const getBoxHeight = (): number => Math.min(maxHeight, Math.max(1, loadedLines + (loadedLines < totalLines ? 1 : 0)));

  const bodyNode = txt(solid, getVisibleText(), fg, { width: '100%', textAlign: 'center' });
  const footerNode = txt(solid, getFooterText(), theme.textMuted, { width: '100%', textAlign: 'center' });

  let scrollbox: unknown;
  const loadMore = (lines?: unknown): boolean => {
    if (loadedLines >= totalLines) return false;
    const step = typeof lines === 'number' ? lines : chunkLines;
    loadedLines = Math.min(totalLines, loadedLines + step);
    solid.setProp(bodyNode, 'content', getVisibleText());
    solid.setProp(footerNode, 'content', getFooterText());
    if (scrollbox !== undefined) {
      solid.setProp(scrollbox, 'height', getBoxHeight());
    }
    renderer?.requestRender();
    return true;
  };

  const updateText = (nextFullText: string): boolean => {
    if (nextFullText === currentFullText) return false;
    const wasAtBottom = loadedLines >= totalLines;
    currentFullText = nextFullText;
    allLines = currentFullText.split('\n');
    totalLines = allLines.length;
    if (wasAtBottom) {
      loadedLines = totalLines;
    } else {
      loadedLines = Math.min(totalLines, Math.max(loadedLines, Math.min(totalLines, chunkLines)));
    }
    solid.setProp(bodyNode, 'content', getVisibleText());
    solid.setProp(footerNode, 'content', getFooterText());
    if (scrollbox !== undefined) {
      solid.setProp(scrollbox, 'height', getBoxHeight());
    }
    renderer?.requestRender();
    return true;
  };

  scrollbox = el(
    solid,
    'scrollbox',
    {
      width: '100%',
      height: getBoxHeight(),
      maxHeight,
      focused: true,
      onScroll: loadMore,
      onWheel: loadMore,
      loadMore,
      loadAll: () => loadMore(totalLines),
      updateText,
    },
    [bodyNode, footerNode],
  );
  (scrollbox as Record<string, unknown>).updateText = updateText;

  try {
    (scrollbox as any).on?.('scroll', loadMore);
    (scrollbox as any).verticalScrollBar?.on?.('change', loadMore);
  } catch {}

  return scrollbox;
};

export const buildHookLogsBody = (
  record: HookRunLogRecord,
  theme: SidebarTheme,
  solid: SolidRuntime,
  onClose: () => void,
  maxHeight: number,
  renderer?: { requestRender: () => void },
  chunkLines = DEFAULT_LOG_CHUNK_LINES,
): unknown => {
  const fullText = formatHookLogsMessage(record);
  const scrollbox = buildScrollableTextBox(fullText, theme.text, theme, solid, maxHeight, renderer, chunkLines);

  const updateRecord = (nextRecord: HookRunLogRecord): boolean => {
    const nextText = formatHookLogsMessage(nextRecord);
    const fn = (scrollbox as any)?.updateText ?? (scrollbox as any)?.props?.updateText;
    return typeof fn === 'function' ? Boolean(fn(nextText)) : false;
  };

  const root = el(
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
      updateRecord,
    },
    [buildHeader(solid, `Hook logs: ${record.name}`, theme, onClose), scrollbox],
  );
  (root as Record<string, unknown>).updateRecord = updateRecord;
  return root;
};

export const buildHookRunDetailBody = (
  record: HookRunLogRecord,
  logFile: string,
  theme: SidebarTheme,
  solid: SolidRuntime,
  onShowLogs: () => void,
  onClose: () => void,
  totalRunsInSession = 0,
  renderer?: { requestRender: () => void },
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

  let currentDetailsText = formatDetails(record, totalRunsInSession);
  const detailsNode = txt(solid, currentDetailsText, theme.textMuted, { width: '100%', textAlign: 'center' });

  const update = (nextRecord: HookRunLogRecord, nextTotalRuns = totalRunsInSession): boolean => {
    const nextDetailsText = formatDetails(nextRecord, nextTotalRuns);
    if (nextDetailsText === currentDetailsText) return false;
    currentDetailsText = nextDetailsText;
    solid.setProp(detailsNode, 'content', nextDetailsText);
    renderer?.requestRender();
    return true;
  };

  const root = el(
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
      update,
    },
    [
      buildHeader(solid, `Hook run: ${record.name}`, theme, onClose),
      detailsNode,
      el(solid, 'box', { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', width: '100%' }, [button]),
    ],
  );
  (root as Record<string, unknown>).update = update;
  return root;
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

  const effectiveSessionID = sessionID ?? entry?.sessionID ?? records[records.length - 1]?.sessionID;
  const streamLogs = readHookStreamLogs(logFile, row.name, effectiveSessionID);
  if (streamLogs.stdout.length > 0 || streamLogs.stderr.length > 0) {
    const base = records[records.length - 1] ?? createIdleRecord(row, effectiveSessionID);
    const mergedLast: HookRunLogRecord = {
      ...base,
      stdout: streamLogs.stdout,
      stderr: streamLogs.stderr,
    };
    records = records.length <= 1 ? [mergedLast] : [...records.slice(0, -1), mergedLast];
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
    let latestRecords = records;
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
        const latest = resolveSessionRecords(logFile, row, notBefore, sessionID, statusFile, fallbackEntry);
        const initialRecord = latest[latest.length - 1] ?? latestRecords[latestRecords.length - 1] ?? targetRecord;
        let updateRecord: ((nextRecord: HookRunLogRecord) => boolean) | undefined;
        const logsHandle: ActiveDialogHandle = {
          event: row.event,
          row,
          notBefore,
          ...(sessionID !== undefined ? { sessionID } : {}),
          update: (nextRecords) => {
            latestRecords = nextRecords;
            const effective = nextRecords[nextRecords.length - 1] ?? createIdleRecord(row, sessionID);
            return typeof updateRecord === 'function' ? Boolean(updateRecord(effective)) : false;
          },
          dispose: () => {
            if (currentDialogHandle === logsHandle) {
              currentDialogHandle = undefined;
            }
          },
        };
        currentDialogHandle = logsHandle;
        api.ui.dialog.replace(() => {
          const effective = latestRecords[latestRecords.length - 1] ?? initialRecord;
          const logsBody = buildHookLogsBody(effective, theme, solid, onClose, maxHeight, api.renderer);
          updateRecord = (logsBody as any)?.updateRecord ?? (logsBody as any)?.props?.updateRecord;
          return logsBody as SolidElement;
        }, logsHandle.dispose);
        api.ui.dialog.setSize(DETAIL_DIALOG_SIZE);
      } catch {}
    };
    let updateDetail: ((nextRecord: HookRunLogRecord, nextTotalRuns?: number) => boolean) | undefined;
    const detailHandle: ActiveDialogHandle = {
      event: row.event,
      row,
      notBefore,
      ...(sessionID !== undefined ? { sessionID } : {}),
      update: (nextRecords) => {
        latestRecords = nextRecords;
        const nextTarget = nextRecords[nextRecords.length - 1] ?? createIdleRecord(row, sessionID);
        return typeof updateDetail === 'function' ? Boolean(updateDetail(nextTarget, nextRecords.length)) : false;
      },
      dispose: () => {
        if (currentDialogHandle === detailHandle) {
          currentDialogHandle = undefined;
        }
      },
    };
    currentDialogHandle = detailHandle;
    api.ui.dialog.replace(() => {
      const currentTarget = latestRecords[latestRecords.length - 1] ?? targetRecord;
      const detailBody = buildHookRunDetailBody(currentTarget, logFile, theme, solid, showLogs, onClose, latestRecords.length, api.renderer);
      updateDetail = (detailBody as any)?.update ?? (detailBody as any)?.props?.update;
      return detailBody as SolidElement;
    }, detailHandle.dispose);
    api.ui.dialog.setSize(DETAIL_DIALOG_SIZE);
  } catch {}
};
