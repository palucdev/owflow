import type { TuiPluginApi } from '@opencode-ai/plugin/tui';

export interface SolidRuntime {
  readonly createElement: (tag: string) => unknown;
  readonly insert: (parent: unknown, child: unknown) => unknown;
  readonly setProp: (node: unknown, name: string, value: unknown) => unknown;
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

export const loadSolidRuntime = async (): Promise<SolidRuntime | null> => {
  try {
    const runtime = (await import('@opentui/solid')) as Partial<SolidRuntime>;
    return typeof runtime.createElement === 'function' && typeof runtime.insert === 'function' && typeof runtime.setProp === 'function'
      ? (runtime as SolidRuntime)
      : null;
  } catch (error) {
    console.warn('[owflow] Failed to import @opentui/solid', error);
    return null;
  }
};
