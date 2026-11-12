import type { TuiPluginApi } from '@opencode-ai/plugin/tui';

export interface SolidRuntime {
  readonly createElement: (tag: string) => unknown;
  readonly insert: (parent: unknown, child: unknown) => unknown;
  readonly setProp: (node: unknown, name: string, value: unknown) => unknown;
  readonly onCleanup?: (fn: () => void) => void;
}

export interface SidebarTheme {
  readonly text: unknown;
  readonly textMuted: unknown;
  readonly primary: unknown;
  readonly selectedListItemText: unknown;
  readonly backgroundElement: unknown;
  readonly warning: unknown;
  readonly success: unknown;
  readonly error: unknown;
}

export type SolidElement = ReturnType<TuiPluginApi['ui']['Dialog']>;

export const el = (solid: SolidRuntime, tag: string, props: Record<string, unknown>, children: readonly unknown[] = []): unknown => {
  const node = solid.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v !== undefined) {
      try {
        solid.setProp(node, k, v);
      } catch {}
    }
  }
  for (const child of children) {
    if (child !== undefined) solid.insert(node, child);
  }
  return node;
};

export const txt = (solid: SolidRuntime, content: string, fg: unknown, extra: Record<string, unknown> = {}): unknown =>
  el(solid, 'text', { fg, content, ...extra });

export const loadSolidRuntime = async (
  importSolid: () => Promise<unknown> = () => import('@opentui/solid'),
  importSolidJs: () => Promise<unknown> = () => import('solid-js'),
): Promise<SolidRuntime | null> => {
  try {
    const runtime = (await importSolid()) as Partial<SolidRuntime>;
    let onCleanup: ((fn: () => void) => void) | undefined;
    if (typeof (runtime as Record<string, unknown>).onCleanup === 'function') {
      onCleanup = (runtime as Record<string, unknown>).onCleanup as (fn: () => void) => void;
    } else {
      try {
        const solidJs = (await importSolidJs()) as { onCleanup?: (fn: () => void) => void };
        if (typeof solidJs.onCleanup === 'function') {
          onCleanup = solidJs.onCleanup;
        }
      } catch {}
    }

    return typeof runtime.createElement === 'function' && typeof runtime.insert === 'function' && typeof runtime.setProp === 'function'
      ? {
          createElement: runtime.createElement,
          insert: runtime.insert,
          setProp: runtime.setProp,
          ...(onCleanup !== undefined ? { onCleanup } : {}),
        }
      : null;
  } catch (error) {
    console.warn('[owflow] Failed to import @opentui/solid', error);
    return null;
  }
};
