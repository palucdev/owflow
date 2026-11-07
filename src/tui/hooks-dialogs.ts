import type { TuiPluginApi } from '@opencode-ai/plugin/tui';
import { HookRunState, type HookRunLogRecord, type HookRuntimeEntry } from '../types/hook-types.js';
import { formatHookRunSummary, formatSessionHookLogsMessage, type ActiveHookRow } from './hooks-formatting.js';
import { el, txt, type SidebarTheme, type SolidElement, type SolidRuntime } from './primitives.js';
import { readHookStatusSnapshot, readSessionHookLogs } from '../hooks/hooks-logs.js';

const SHOW_LOGS_LABEL = 'View logs';
const DETAIL_DIALOG_SIZE = 'large';
export const DEFAULT_LOG_CHUNK_LINES = 100;

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
  textAlign?: string,
): unknown => {
  const allLines = fullText.split('\n');
  const totalLines = allLines.length;

  let loadedLines = Math.min(totalLines, chunkLines);

  const getVisibleText = (): string => allLines.slice(0, loadedLines).join('\n');
  const getFooterText = (): string => (loadedLines < totalLines ? `[scroll for more logs: ${loadedLines}/${totalLines} lines loaded]` : '');

  const bodyNode = txt(solid, getVisibleText(), fg, { width: '100%', ...(textAlign ? { textAlign } : {}) });
  const footerNode = txt(solid, getFooterText(), theme.textMuted, { width: '100%', ...(textAlign ? { textAlign } : {}) });

  const children: unknown[] = [bodyNode];
  if (loadedLines < totalLines) {
    children.push(footerNode);
  }

  const loadMore = (lines?: unknown): boolean => {
    if (loadedLines >= totalLines) return false;
    const step = typeof lines === 'number' ? lines : chunkLines;
    loadedLines = Math.min(totalLines, loadedLines + step);
    solid.setProp(bodyNode, 'content', getVisibleText());
    solid.setProp(footerNode, 'content', getFooterText());
    renderer?.requestRender();
    return true;
  };

  const scrollbox = el(
    solid,
    'scrollbox',
    {
      flexGrow: 1,
      width: '100%',
      maxHeight,
      focused: true,
      onScroll: loadMore,
      onWheel: loadMore,
      loadMore,
      loadAll: () => loadMore(totalLines),
    },
    children,
  );

  try {
    (scrollbox as any).on?.('scroll', loadMore);
    (scrollbox as any).verticalScrollBar?.on?.('change', loadMore);
  } catch {}

  return scrollbox;
};

export const buildHookLogsBody = (
  recordOrRecords: HookRunLogRecord | readonly HookRunLogRecord[],
  theme: SidebarTheme,
  solid: SolidRuntime,
  onClose: () => void,
  maxHeight: number,
  renderer?: { requestRender: () => void },
  chunkLines = DEFAULT_LOG_CHUNK_LINES,
): unknown => {
  const records = Array.isArray(recordOrRecords) ? recordOrRecords : [recordOrRecords];
  const name = records[0]?.name ?? 'unknown';
  const fullText = formatSessionHookLogsMessage(records);
  const scrollbox = buildScrollableTextBox(fullText, theme.text, theme, solid, maxHeight, renderer, chunkLines);

  return el(solid, 'box', { flexDirection: 'column', width: '100%', paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1, gap: 1 }, [
    buildHeader(solid, `Hook logs: ${name}`, theme, onClose),
    scrollbox,
  ]);
};

export const buildHookRunDetailBody = (
  record: HookRunLogRecord,
  logFile: string,
  theme: SidebarTheme,
  solid: SolidRuntime,
  onShowLogs: () => void,
  onClose: () => void,
  totalRunsInSession?: number,
  maxHeight = 12,
  renderer?: { requestRender: () => void },
  chunkLines = DEFAULT_LOG_CHUNK_LINES,
): unknown => {
  const buttonLabel = txt(solid, SHOW_LOGS_LABEL, theme.selectedListItemText, { flexShrink: 0 });
  const button: unknown = el(
    solid,
    'box',
    {
      backgroundColor: theme.primary,
      paddingLeft: 3,
      paddingRight: 3,
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

  const summaryScrollbox = buildScrollableTextBox(
    formatHookRunSummary(record),
    theme.textMuted,
    theme,
    solid,
    maxHeight,
    renderer,
    chunkLines,
    'center',
  );

  return el(
    solid,
    'box',
    {
      flexDirection: 'column',
      alignItems: 'center',
      width: '100%',
      paddingLeft: 2,
      paddingRight: 2,
      paddingTop: 1,
      paddingBottom: 1,
      gap: 1,
    },
    [
      buildHeader(solid, `Hook run: ${record.name}`, theme, onClose),
      summaryScrollbox,
      ...(totalRunsInSession !== undefined && totalRunsInSession > 1
        ? [txt(solid, `Runs in session: ${totalRunsInSession}`, theme.textMuted, { width: '100%', textAlign: 'center' })]
        : []),
      txt(solid, `Log file: ${logFile}`, theme.textMuted, { width: '100%', textAlign: 'center' }),
      el(solid, 'box', { flexDirection: 'row', justifyContent: 'center', width: '100%' }, [button]),
    ],
  );
};

const resolveSessionRecords = (
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

  if (entry?.status === HookRunState.PENDING) {
    const belongs = sessionID && entry.sessionID ? entry.sessionID === sessionID : true;
    if (belongs && records[records.length - 1]?.status !== HookRunState.PENDING) {
      const now = Date.now();
      const pendingRecord: HookRunLogRecord = {
        version: 1,
        runId: `${row.event}#pending`,
        pid: process.pid,
        workspace: '',
        event: row.event,
        hook: row.name,
        name: row.name,
        ...(entry.sessionID !== undefined ? { sessionID: entry.sessionID } : sessionID !== undefined ? { sessionID } : {}),
        startedAt: entry.startedAt,
        finishedAt: entry.finishedAt ?? now,
        durationMs: entry.durationMs ?? Math.max(0, now - entry.startedAt),
        status: HookRunState.PENDING,
        ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
        ...(entry.stdout !== undefined ? { stdout: entry.stdout } : {}),
        ...(entry.stderr !== undefined ? { stderr: entry.stderr } : {}),
      };
      records = [...records, pendingRecord];
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
  const records = resolveSessionRecords(logFile, row, notBefore, sessionID, statusFile, fallbackEntry);
  try {
    if (records.length === 0) {
      api.ui.toast({
        variant: 'info',
        title: 'Hook logs',
        message: `No runs recorded for ${row.name} in this session yet.`,
      });
      return;
    }
    const targetRecord = records[records.length - 1]!;
    const h = api.renderer.height;
    const maxHeight = Math.max(4, Math.floor(((h > 0 ? h : 24) * 3) / 4) - 8);
    const detailMaxHeight = Math.max(4, maxHeight - 4);
    const onClose = (): void => api.ui.dialog.clear();
    const showLogs = (): void => {
      try {
        const latest = resolveSessionRecords(logFile, row, notBefore, sessionID, statusFile, fallbackEntry);
        const logRecords = latest.length > 0 ? latest : records;
        api.ui.dialog.replace(() => buildHookLogsBody(logRecords, theme, solid, onClose, maxHeight, api.renderer) as SolidElement);
        api.ui.dialog.setSize(DETAIL_DIALOG_SIZE);
      } catch {}
    };
    api.ui.dialog.replace(
      () =>
        buildHookRunDetailBody(targetRecord, logFile, theme, solid, showLogs, onClose, records.length, detailMaxHeight, api.renderer) as SolidElement,
    );
    api.ui.dialog.setSize(DETAIL_DIALOG_SIZE);
  } catch {}
};
