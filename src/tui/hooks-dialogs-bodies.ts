import { formatHookLogsMessage, formatHookRunSummary } from './hooks-presenter.js';
import { createElementNode, txt, type SidebarTheme, type SolidRuntime } from './primitives.js';
import type { HookRunLogRecord } from '../types/hook-types.js';

const SHOW_LOGS_LABEL = 'View logs';
const DEFAULT_TERMINAL_HEIGHT = 24;

interface HeaderOptions {
  readonly solid: SolidRuntime;
  readonly titleText: string;
  readonly theme: SidebarTheme;
  readonly onClose: () => void;
}

const buildHeader = (options: HeaderOptions): unknown => {
  const { solid, titleText, theme, onClose } = options;
  return createElementNode({
    solid,
    tag: 'box',
    properties: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 1 },
    children: [
      txt({ solid, content: titleText, foreground: theme.text, extra: { flexGrow: 1, textAlign: 'center' } }),
      txt({ solid, content: 'esc', foreground: theme.textMuted, extra: { flexShrink: 0, onMouseUp: onClose } }),
    ],
  });
};

export interface HookLogsBodyOptions {
  readonly record: HookRunLogRecord;
  readonly theme: SidebarTheme;
  readonly solid: SolidRuntime;
  readonly onClose: () => void;
  readonly maxHeight?: number;
}

export const buildHookLogsBody = (options: HookLogsBodyOptions): unknown => {
  const { record, theme, solid, onClose, maxHeight = DEFAULT_TERMINAL_HEIGHT } = options;
  const fullText = formatHookLogsMessage(record);
  const bodyNode = txt({ solid, content: fullText, foreground: theme.text, extra: { width: '100%', textAlign: 'left' } });
  const scrollbox = createElementNode({
    solid,
    tag: 'scrollbox',
    properties: { width: '100%', height: maxHeight, focused: true },
    children: [bodyNode],
  });

  return createElementNode({
    solid,
    tag: 'box',
    properties: {
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
    children: [buildHeader({ solid, titleText: `Hook logs: ${record.name}`, theme, onClose }), scrollbox],
  });
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

const createShowLogsButton = (solid: SolidRuntime, context: { readonly theme: SidebarTheme; readonly onShowLogs: () => void }): unknown => {
  const { theme, onShowLogs } = context;
  const buttonLabel = txt({ solid, content: SHOW_LOGS_LABEL, foreground: theme.selectedListItemText, extra: { flexShrink: 0 } });
  const buttonReference: { current: unknown } = { current: undefined };
  const buttonNode = createElementNode({
    solid,
    tag: 'box',
    properties: {
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
    children: [buttonLabel],
  });
  buttonReference.current = buttonNode;
  return buttonNode;
};

export const buildHookRunDetailBody = (options: HookDetailBodyOptions): unknown => {
  const { record, logFile, theme, solid, onShowLogs, onClose, totalRunsInSession = 0 } = options;

  const button = createShowLogsButton(solid, { theme, onShowLogs });
  const detailsText = [formatHookRunSummary(record), `Runs in session: ${totalRunsInSession}`, `Log file: ${logFile}`].join('\n');
  const detailsNode = txt({ solid, content: detailsText, foreground: theme.textMuted, extra: { width: '100%', textAlign: 'center' } });

  return createElementNode({
    solid,
    tag: 'box',
    properties: {
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
    children: [
      buildHeader({ solid, titleText: `Hook run: ${record.name}`, theme, onClose }),
      detailsNode,
      createElementNode({
        solid,
        tag: 'box',
        properties: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', width: '100%' },
        children: [button],
      }),
    ],
  });
};
