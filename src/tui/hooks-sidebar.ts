import type { HookRunState, HookRuntimeEntry } from '../types/hook-types.js';
import { colorForStatus, statusLabelFor, type ActiveHookRow, type ActiveHooksView } from './hooks-presenter.js';
import { populateSidebarRows } from './hooks-sidebar-row.js';
import { createElementNode, type SidebarTheme, type SolidRuntime } from './primitives.js';

export interface SidebarRenderHandle {
  readonly root: unknown;
  readonly applyStatuses: (snapshotEntries: ReadonlyMap<string, HookRuntimeEntry>) => boolean;
  readonly disposed: () => boolean;
  readonly dispose: () => void;
}

export interface SidebarMaterializeOptions {
  readonly view: ActiveHooksView;
  readonly theme: SidebarTheme;
  readonly solid: SolidRuntime;
  readonly onRowClick: (row: ActiveHookRow, theme: SidebarTheme) => void;
  readonly onRowHover: () => void;
  readonly isInteractive?: boolean;
  readonly interactive?: boolean;
  readonly notBefore?: number;
  readonly sessionID?: string;
  readonly initialStates?: ReadonlyMap<string, HookRunState>;
}

const resolveSidebarOptions = (
  optionsOrView: SidebarMaterializeOptions | ActiveHooksView,
  rest: readonly unknown[],
): SidebarMaterializeOptions => {
  if ('view' in optionsOrView) {
    return optionsOrView;
  }
  const theme = rest[0] as SidebarTheme;
  const solid = rest[1] as SolidRuntime;
  const onRowClick = rest[2] as (row: ActiveHookRow, theme: SidebarTheme) => void;
  const onRowHover = rest[3] as () => void;
  const isInteractive = typeof rest[4] === 'boolean' && rest[4];
  const notBefore = typeof rest[5] === 'number' ? rest[5] : 0;
  const sessionID = typeof rest[6] === 'string' ? rest[6] : undefined;
  const initialStates = rest[7] as ReadonlyMap<string, HookRunState> | undefined;

  return {
    view: optionsOrView,
    theme,
    solid,
    onRowClick,
    onRowHover,
    isInteractive,
    notBefore,
    sessionID,
    initialStates,
  };
};

interface UpdateContext {
  readonly rows: ReadonlyMap<string, { readonly orb: unknown; readonly label: unknown }>;
  readonly colors: Map<string, string>;
  readonly sessionStates: Map<string, HookRunState>;
  readonly solid: SolidRuntime;
  readonly theme: SidebarTheme;
  readonly notBefore: number;
  readonly sessionID?: string;
  readonly isDisposed: () => boolean;
}

interface SessionMatchOptions {
  readonly sessionID?: string;
  readonly notBefore: number;
}

const doesEntryBelongToSession = (
  entry: HookRuntimeEntry,
  options: SessionMatchOptions,
): boolean => {
  const { sessionID, notBefore } = options;
  return sessionID !== undefined && sessionID.length > 0
    ? entry.sessionID === sessionID || (entry.sessionID === undefined && entry.startedAt >= notBefore)
    : entry.startedAt >= notBefore;
};

const hasAppliedStatusStylesToRows = (context: UpdateContext): boolean => {
  let hasChanged = false;
  for (const [event, nodes] of context.rows) {
    const status = context.sessionStates.get(event);
    const key = status ?? 'idle';
    if (context.colors.get(event) === key) {
      continue;
    }
    context.solid.setProp(nodes.orb, 'fg', colorForStatus(status, context.theme));
    context.solid.setProp(nodes.label, 'content', statusLabelFor(status));
    context.colors.set(event, key);
    hasChanged = true;
  }
  return hasChanged;
};

const createStatusUpdater = (
  context: UpdateContext,
): ((snapshotEntries: ReadonlyMap<string, HookRuntimeEntry>) => boolean) =>
  (snapshotEntries) => {
    if (context.isDisposed()) {
      return false;
    }
    try {
      for (const [event, entry] of snapshotEntries) {
        if (doesEntryBelongToSession(entry, { sessionID: context.sessionID, notBefore: context.notBefore })) {
          context.sessionStates.set(event, entry.status);
        }
      }
      return hasAppliedStatusStylesToRows(context);
    } catch {
      return false;
    }
  };

interface DisposalState {
  readonly isDisposed: () => boolean;
  readonly dispose: () => void;
}

const setupDisposal = (
  maps: readonly { clear: () => void }[],
  solid: SolidRuntime,
): DisposalState => {
  let isDisposed = false;
  const dispose = (): void => {
    if (isDisposed) {
      return;
    }
    isDisposed = true;
    for (const map of maps) {
      map.clear();
    }
  };
  if (typeof solid.onCleanup === 'function') {
    try {
      solid.onCleanup(dispose);
    } catch {
      // ignore onCleanup registration error
    }
  }
  return { isDisposed: () => isDisposed, dispose };
};

export const materializeSidebar = (
  optionsOrView: SidebarMaterializeOptions | ActiveHooksView,
  ...rest: readonly unknown[]
): SidebarRenderHandle => {
  const options = resolveSidebarOptions(optionsOrView, rest);
  const { view, theme, solid, onRowClick, onRowHover, sessionID, notBefore = 0 } = options;
  const isInteractive = options.isInteractive ?? options.interactive ?? false;

  const rows = new Map<string, { readonly orb: unknown; readonly label: unknown }>();
  const colors = new Map<string, string>();
  const sessionStates = new Map<string, HookRunState>(options.initialStates);
  const root = createElementNode(solid, 'box', { flexDirection: 'column' }, [
    createElementNode(solid, 'text', { fg: theme.text }, [view.title]),
  ]);

  const { isDisposed, dispose } = setupDisposal([rows, colors, sessionStates], solid);

  populateSidebarRows({
    viewRows: view.rows,
    solid,
    theme,
    root,
    rows,
    colors,
    sessionStates,
    isInteractive,
    isDisposed,
    onRowClick,
    onRowHover,
  });

  const hasUpdatedStatusesWithSnapshot = createStatusUpdater({
    rows,
    colors,
    sessionStates,
    solid,
    theme,
    notBefore,
    sessionID,
    isDisposed,
  });

  return {
    root,
    applyStatuses: hasUpdatedStatusesWithSnapshot,
    disposed: () => isDisposed() || Boolean((root as { isDestroyed?: unknown } | null)?.isDestroyed),
    dispose,
  };
};
