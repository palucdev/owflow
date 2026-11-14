import { formatHookLogsMessage, formatHookRunSummary } from './hooks-presenter.js';
import { createElementNode, txt, type SidebarTheme, type SolidRuntime } from './primitives.js';
import type { HookRunLogRecord } from '../types/hook-types.js';

const SHOW_LOGS_LABEL = 'View logs';
const DEFAULT_TERMINAL_HEIGHT = 24;

export interface HeaderOptions {
  readonly solid: SolidRuntime;
  readonly titleText: string;
  readonly theme: SidebarTheme;
  readonly onClose: () => void;
}

const resolveHeaderOptions = (
  solidOrOptions: SolidRuntime | HeaderOptions,
  rest: readonly unknown[],
): HeaderOptions => {
  if ('solid' in solidOrOptions) {
    return solidOrOptions;
  }
  const titleText = typeof rest[0] === 'string' ? rest[0] : '';
  const theme = rest[1] as SidebarTheme;
  const onClose = typeof rest[2] === 'function' ? (rest[2] as () => void) : () => {};
  return { solid: solidOrOptions, titleText, theme, onClose };
};

export const buildHeader = (
  solidOrOptions: SolidRuntime | HeaderOptions,
  ...rest: readonly unknown[]
): unknown => {
  const { solid, titleText, theme, onClose } = resolveHeaderOptions(solidOrOptions, rest);
  return createElementNode(
    solid,
    'box',
    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 1 },
    [
      txt(solid, titleText, theme.text, { flexGrow: 1, textAlign: 'center' }),
      txt(solid, 'esc', theme.textMuted, { flexShrink: 0, onMouseUp: onClose }),
    ],
  );
};

export interface HookLogsBodyOptions {
  readonly record: HookRunLogRecord;
  readonly theme: SidebarTheme;
  readonly solid: SolidRuntime;
  readonly onClose: () => void;
  readonly maxHeight: number;
}

const resolveHookLogsBodyOptions = (
  recordOrOptions: HookRunLogRecord | HookLogsBodyOptions,
  rest: readonly unknown[],
): HookLogsBodyOptions => {
  if ('theme' in recordOrOptions) {
    return recordOrOptions;
  }
  const theme = rest[0] as SidebarTheme;
  const solid = rest[1] as SolidRuntime;
  const onClose = rest[2] as () => void;
  const maxHeight = typeof rest[3] === 'number' ? rest[3] : DEFAULT_TERMINAL_HEIGHT;
  return { record: recordOrOptions, theme, solid, onClose, maxHeight };
};

export const buildHookLogsBody = (
  recordOrOptions: HookRunLogRecord | HookLogsBodyOptions,
  ...rest: readonly unknown[]
): unknown => {
  const { record, theme, solid, onClose, maxHeight } = resolveHookLogsBodyOptions(
    recordOrOptions,
    rest,
  );
  const fullText = formatHookLogsMessage(record);
  const bodyNode = txt(solid, fullText, theme.text, { width: '100%', textAlign: 'left' });
  const scrollbox = createElementNode(
    solid,
    'scrollbox',
    { width: '100%', height: maxHeight, focused: true },
    [bodyNode],
  );

  return createElementNode(
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

export interface HookDetailBodyOptions {
  readonly record: HookRunLogRecord;
  readonly logFile: string;
  readonly theme: SidebarTheme;
  readonly solid: SolidRuntime;
  readonly onShowLogs: () => void;
  readonly onClose: () => void;
  readonly totalRunsInSession?: number;
}

const resolveHookDetailBodyOptions = (
  recordOrOptions: HookRunLogRecord | HookDetailBodyOptions,
  rest: readonly unknown[],
): HookDetailBodyOptions => {
  if ('logFile' in recordOrOptions) {
    return recordOrOptions;
  }
  const logFile = typeof rest[0] === 'string' ? rest[0] : '';
  const theme = rest[1] as SidebarTheme;
  const solid = rest[2] as SolidRuntime;
  const onShowLogs = rest[3] as () => void;
  const onClose = rest[4] as () => void;
  const totalRunsInSession = typeof rest[5] === 'number' ? rest[5] : 0;
  return { record: recordOrOptions, logFile, theme, solid, onShowLogs, onClose, totalRunsInSession };
};

const createShowLogsButton = (
  solid: SolidRuntime,
  context: { readonly theme: SidebarTheme; readonly onShowLogs: () => void },
): unknown => {
  const { theme, onShowLogs } = context;
  const buttonLabel = txt(solid, SHOW_LOGS_LABEL, theme.selectedListItemText, { flexShrink: 0 });
  const buttonReference: { current: unknown } = { current: undefined };
  const buttonNode = createElementNode(
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
        solid.setProp(buttonReference.current, 'backgroundColor', theme.backgroundElement);
        solid.setProp(buttonLabel, 'fg', theme.primary);
      },
      onMouseOut: () => {
        solid.setProp(buttonReference.current, 'backgroundColor', theme.primary);
        solid.setProp(buttonLabel, 'fg', theme.selectedListItemText);
      },
    },
    [buttonLabel],
  );
  buttonReference.current = buttonNode;
  return buttonNode;
};

export const buildHookRunDetailBody = (
  recordOrOptions: HookRunLogRecord | HookDetailBodyOptions,
  ...rest: readonly unknown[]
): unknown => {
  const { record, logFile, theme, solid, onShowLogs, onClose, totalRunsInSession = 0 } =
    resolveHookDetailBodyOptions(recordOrOptions, rest);

  const button = createShowLogsButton(solid, { theme, onShowLogs });
  const detailsText = [
    formatHookRunSummary(record),
    `Runs in session: ${totalRunsInSession}`,
    `Log file: ${logFile}`,
  ].join('\n');
  const detailsNode = txt(solid, detailsText, theme.textMuted, { width: '100%', textAlign: 'center' });

  return createElementNode(
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
      createElementNode(
        solid,
        'box',
        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', width: '100%' },
        [button],
      ),
    ],
  );
};
