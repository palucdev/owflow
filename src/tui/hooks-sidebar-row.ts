import { colorForStatus, statusLabelFor, type ActiveHookRow } from './hooks-presenter.js';
import { createElementNode, txt, type SidebarTheme, type SolidRuntime } from './primitives.js';
import type { HookRunState } from '../types/hook-types.js';

const EMPTY_HOOKS_NAME = '(none)';
const OPEN_HINT = '›';

export interface SidebarRowOptions {
  readonly solid: SolidRuntime;
  readonly theme: SidebarTheme;
  readonly row: ActiveHookRow;
  readonly initialStatus?: HookRunState;
  readonly isInteractive: boolean;
  readonly isDisposed: () => boolean;
  readonly onRowClick: (row: ActiveHookRow, theme: SidebarTheme) => void;
  readonly onRowHover: () => void;
}

export interface SidebarRowResult {
  readonly line: unknown;
  readonly nodes: { readonly orb: unknown; readonly label: unknown };
  readonly initialKey: string;
}

const buildInteractiveRowHandlers = (
  options: SidebarRowOptions,
  nodes: { readonly getLine: () => unknown; readonly name: unknown; readonly hint: unknown },
) => {
  if (!options.isInteractive) {
    return {};
  }
  return {
    onMouseUp: () => {
      if (!options.isDisposed()) {
        options.onRowClick(options.row, options.theme);
      }
    },
    onMouseOver: () => {
      if (options.isDisposed()) {
        return;
      }
      options.solid.setProp(nodes.getLine(), 'backgroundColor', options.theme.backgroundElement);
      options.solid.setProp(nodes.name, 'fg', options.theme.primary);
      options.solid.setProp(nodes.hint, 'fg', options.theme.primary);
      options.onRowHover();
    },
    onMouseOut: () => {
      if (options.isDisposed()) {
        return;
      }
      options.solid.setProp(nodes.getLine(), 'backgroundColor', undefined);
      options.solid.setProp(nodes.name, 'fg', options.theme.text);
      options.solid.setProp(nodes.hint, 'fg', options.theme.textMuted);
      options.onRowHover();
    },
  };
};

export const createSidebarRow = (options: SidebarRowOptions): SidebarRowResult => {
  const { solid, theme, row, initialStatus, isInteractive } = options;
  const initialKey = initialStatus ?? 'idle';
  const orb = txt(solid, '•', colorForStatus(initialStatus, theme), { flexShrink: 0 });
  const name = txt(solid, row.name, theme.text);
  const label = txt(solid, statusLabelFor(initialStatus), theme.textMuted);
  const hint = isInteractive ? txt(solid, OPEN_HINT, theme.textMuted, { flexShrink: 0 }) : undefined;

  const lineReference: { current: unknown } = { current: undefined };
  const handlers = buildInteractiveRowHandlers(options, {
    getLine: () => lineReference.current,
    name,
    hint,
  });

  const lineNode = createElementNode(
    solid,
    'box',
    {
      flexDirection: 'row',
      gap: 1,
      ...handlers,
    },
    [orb, name, label, hint],
  );
  lineReference.current = lineNode;

  return { line: lineNode, nodes: { orb, label }, initialKey };
};

export interface PopulateRowsOptions {
  readonly viewRows: readonly ActiveHookRow[];
  readonly solid: SolidRuntime;
  readonly theme: SidebarTheme;
  readonly root: unknown;
  readonly rows: Map<string, { readonly orb: unknown; readonly label: unknown }>;
  readonly colors: Map<string, string>;
  readonly sessionStates: Map<string, HookRunState>;
  readonly isInteractive: boolean;
  readonly isDisposed: () => boolean;
  readonly onRowClick: (row: ActiveHookRow, theme: SidebarTheme) => void;
  readonly onRowHover: () => void;
}

export const populateSidebarRows = (options: PopulateRowsOptions): void => {
  const { viewRows, solid, theme, root, rows, colors, sessionStates } = options;
  if (viewRows.length === 0) {
    solid.insert(root, txt(solid, EMPTY_HOOKS_NAME, theme.textMuted));
    return;
  }
  for (const row of viewRows) {
    const initialStatus = sessionStates.get(row.event);
    const rowResult = createSidebarRow({
      solid,
      theme,
      row,
      initialStatus,
      isInteractive: options.isInteractive,
      isDisposed: options.isDisposed,
      onRowClick: options.onRowClick,
      onRowHover: options.onRowHover,
    });
    solid.insert(root, rowResult.line);
    rows.set(row.event, rowResult.nodes);
    colors.set(row.event, rowResult.initialKey);
  }
};
