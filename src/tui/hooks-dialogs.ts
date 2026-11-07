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
): unknown => {
  const allLines = fullText.split('\n');
  const totalLines = allLines.length;

  let loadedLines = Math.min(totalLines, chunkLines);

  const getVisibleText = (): string => allLines.slice(0, loadedLines).join('\n');
  const getFooterText = (): string => (loadedLines < totalLines ? `[scroll for more logs: ${loadedLines}/${totalLines} lines loaded]` : '');
  const getBoxHeight = (): number => Math.min(maxHeight, Math.max(1, loadedLines + (loadedLines < totalLines ? 1 : 0)));

  const bodyNode = txt(solid, getVisibleText(), fg, { width: '100%', textAlign: 'center' });
  const footerNode = txt(solid, getFooterText(), theme.textMuted, { width: '100%', textAlign: 'center' });

  const children: unknown[] = [bodyNode];
  if (loadedLines < totalLines) {
    children.push(footerNode);
  }

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
    [buildHeader(solid, `Hook logs: ${name}`, theme, onClose), scrollbox],
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

  const detailsText = [formatHookRunSummary(record), `Runs in session: ${totalRunsInSession}`, `Log file: ${logFile}`].join('\n');

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
      txt(solid, detailsText, theme.textMuted, { width: '100%', textAlign: 'center' }),
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
    const targetRecord = records[records.length - 1] ?? createIdleRecord(row, sessionID);
    const h = api.renderer.height;
    const maxHeight = Math.max(4, Math.floor(((h > 0 ? h : 24) * 3) / 4) - 8);
    const onClose = (): void => api.ui.dialog.clear();
    const showLogs = (): void => {
      try {
        const latest = resolveSessionRecords(logFile, row, notBefore, sessionID, statusFile, fallbackEntry);
        const logRecords = latest.length > 0 ? latest : records.length > 0 ? records : [targetRecord];
        api.ui.dialog.replace(() => buildHookLogsBody(logRecords, theme, solid, onClose, maxHeight, api.renderer) as SolidElement);
        api.ui.dialog.setSize(DETAIL_DIALOG_SIZE);
      } catch {}
    };
    api.ui.dialog.replace(() => buildHookRunDetailBody(targetRecord, logFile, theme, solid, showLogs, onClose, records.length) as SolidElement);
    api.ui.dialog.setSize(DETAIL_DIALOG_SIZE);
  } catch {}
};
