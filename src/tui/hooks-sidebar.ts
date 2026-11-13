import type { HookRunState, HookRuntimeEntry } from '../types/hook-types.js';
import { colorForStatus, statusLabelFor, type ActiveHookRow, type ActiveHooksView } from './hooks-presenter.js';
import { el, txt, type SidebarTheme, type SolidRuntime } from './primitives.js';

const EMPTY_HOOKS_NAME = '(none)';
const OPEN_HINT = '›';

export interface SidebarRenderHandle {
  readonly root: unknown;
  readonly applyStatuses: (snapshotEntries: ReadonlyMap<string, HookRuntimeEntry>) => boolean;
  readonly disposed: () => boolean;
  readonly dispose: () => void;
}

export const materializeSidebar = (
  view: ActiveHooksView,
  theme: SidebarTheme,
  solid: SolidRuntime,
  onRowClick: (row: ActiveHookRow, theme: SidebarTheme) => void,
  onRowHover: () => void,
  interactive: boolean,
  notBefore: number,
  sessionID?: string,
  initialStates?: ReadonlyMap<string, HookRunState>,
): SidebarRenderHandle => {
  const rows = new Map<string, { readonly orb: unknown; readonly label: unknown }>();
  const colors = new Map<string, string>();
  const sessionStates = new Map<string, HookRunState>(initialStates);
  const root = el(solid, 'box', { flexDirection: 'column' }, [el(solid, 'text', { fg: theme.text }, [view.title])]);
  let isDisposed = false;

  const dispose = (): void => {
    if (isDisposed) return;
    isDisposed = true;
    rows.clear();
    colors.clear();
    sessionStates.clear();
  };

  if (typeof solid.onCleanup === 'function') {
    try {
      solid.onCleanup(dispose);
    } catch {}
  }

  if (view.rows.length === 0) {
    solid.insert(root, txt(solid, EMPTY_HOOKS_NAME, theme.textMuted));
  } else {
    for (const row of view.rows) {
      const initialStatus = sessionStates.get(row.event);
      const initialKey = initialStatus ?? 'idle';
      const orb = txt(solid, '•', colorForStatus(initialStatus, theme), { flexShrink: 0 });
      const name = txt(solid, row.name, theme.text);
      const label = txt(solid, statusLabelFor(initialStatus), theme.textMuted);
      const hint = interactive ? txt(solid, OPEN_HINT, theme.textMuted, { flexShrink: 0 }) : undefined;
      const line: unknown = el(
        solid,
        'box',
        {
          flexDirection: 'row',
          gap: 1,
          ...(interactive
            ? {
                onMouseUp: () => {
                  if (!isDisposed) onRowClick(row, theme);
                },
                onMouseOver: () => {
                  if (isDisposed) return;
                  solid.setProp(line, 'backgroundColor', theme.backgroundElement);
                  solid.setProp(name, 'fg', theme.primary);
                  solid.setProp(hint, 'fg', theme.primary);
                  onRowHover();
                },
                onMouseOut: () => {
                  if (isDisposed) return;
                  solid.setProp(line, 'backgroundColor', undefined);
                  solid.setProp(name, 'fg', theme.text);
                  solid.setProp(hint, 'fg', theme.textMuted);
                  onRowHover();
                },
              }
            : {}),
        },
        [orb, name, label, hint],
      );
      solid.insert(root, line);
      rows.set(row.event, { orb, label });
      colors.set(row.event, initialKey);
    }
  }

  const applyStatuses = (snapshotEntries: ReadonlyMap<string, HookRuntimeEntry>): boolean => {
    if (isDisposed) return false;
    try {
      let changed = false;
      for (const [event, entry] of snapshotEntries) {
        const belongs =
          sessionID !== undefined && sessionID.length > 0
            ? entry.sessionID === sessionID || (entry.sessionID === undefined && entry.startedAt >= notBefore)
            : entry.startedAt >= notBefore;
        if (belongs) {
          sessionStates.set(event, entry.status);
        }
      }
      for (const [event, nodes] of rows) {
        const status = sessionStates.get(event);
        const key = status ?? 'idle';
        if (colors.get(event) === key) continue;
        solid.setProp(nodes.orb, 'fg', colorForStatus(status, theme));
        solid.setProp(nodes.label, 'content', statusLabelFor(status));
        colors.set(event, key);
        changed = true;
      }
      return changed;
    } catch {
      return false;
    }
  };

  return {
    root,
    applyStatuses,
    disposed: () => isDisposed || Boolean((root as { isDestroyed?: unknown } | null)?.isDestroyed),
    dispose,
  };
};
