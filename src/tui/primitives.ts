import type { TuiPluginApi } from '@opencode-ai/plugin/tui';

export interface SolidRuntime {
  readonly createElement: (tag: string) => unknown;
  readonly insert: (parent: unknown, child: unknown) => unknown;
  readonly setProp: (node: unknown, ...nameAndValue: [string, unknown]) => unknown;
  readonly onCleanup?: (cleanupFunction: () => void) => void;
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

export interface ElementCreationOptions {
  readonly solid: SolidRuntime;
  readonly tag: string;
  readonly properties?: Record<string, unknown>;
  readonly children?: readonly unknown[];
}

const resolveElementCreationOptions = (
  solidOrOptions: SolidRuntime | ElementCreationOptions,
  rest: readonly unknown[],
): ElementCreationOptions => {
  if ('solid' in solidOrOptions) {
    return solidOrOptions;
  }
  const tag = typeof rest[0] === 'string' ? rest[0] : '';
  const properties = (rest[1] as Record<string, unknown> | undefined) ?? {};
  const children = (rest[2] as readonly unknown[] | undefined) ?? [];
  return { solid: solidOrOptions, tag, properties, children };
};

export const createElementNode = (
  solidOrOptions: SolidRuntime | ElementCreationOptions,
  ...rest: readonly unknown[]
): unknown => {
  const { solid, tag, properties = {}, children = [] } = resolveElementCreationOptions(
    solidOrOptions,
    rest,
  );
  const node = solid.createElement(tag);
  for (const [propertyKey, propertyValue] of Object.entries(properties)) {
    if (propertyValue !== undefined) {
      try {
        solid.setProp(node, propertyKey, propertyValue);
      } catch {
        // ignore setProp error
      }
    }
  }
  for (const child of children) {
    if (child !== undefined) {
      solid.insert(node, child);
    }
  }
  return node;
};

export { createElementNode as el };

export interface TextCreationOptions {
  readonly solid: SolidRuntime;
  readonly content: string;
  readonly foreground?: unknown;
  readonly extra?: Record<string, unknown>;
}

const resolveTextOptions = (
  solidOrOptions: SolidRuntime | TextCreationOptions,
  rest: readonly unknown[],
): TextCreationOptions => {
  if ('solid' in solidOrOptions) {
    return solidOrOptions;
  }
  const content = typeof rest[0] === 'string' ? rest[0] : '';
  const foreground = rest[1];
  const extra = (rest[2] as Record<string, unknown> | undefined) ?? {};
  return { solid: solidOrOptions, content, foreground, extra };
};

export const createTextNode = (
  solidOrOptions: SolidRuntime | TextCreationOptions,
  ...rest: readonly unknown[]
): unknown => {
  const { solid, content, foreground, extra = {} } = resolveTextOptions(solidOrOptions, rest);
  return createElementNode(solid, 'text', { fg: foreground, content, ...extra });
};

export { createTextNode as txt };

const resolveCleanupFunction = async (
  runtime: Record<string, unknown>,
  importSolidJs: () => Promise<unknown>,
): Promise<((cleanupFunction: () => void) => void) | undefined> => {
  if (typeof runtime['onCleanup'] === 'function') {
    return runtime['onCleanup'] as (cleanupFunction: () => void) => void;
  }
  try {
    const solidJs = (await importSolidJs()) as { onCleanup?: (cleanupFunction: () => void) => void };
    return typeof solidJs.onCleanup === 'function' ? solidJs.onCleanup : undefined;
  } catch {
    return undefined;
  }
};

export const loadSolidRuntime = async (
  importSolid: () => Promise<unknown> = () => import('@opentui/solid'),
  importSolidJs: () => Promise<unknown> = () => import('solid-js'),
): Promise<SolidRuntime | null> => {
  try {
    const runtime = (await importSolid()) as Partial<SolidRuntime>;
    const onCleanup = await resolveCleanupFunction(
      runtime as Record<string, unknown>,
      importSolidJs,
    );

    const isCompleteRuntime =
      typeof runtime.createElement === 'function' &&
      typeof runtime.insert === 'function' &&
      typeof runtime.setProp === 'function';

    if (!isCompleteRuntime) {
      return JSON.parse('null') as null;
    }

    return {
      createElement: runtime.createElement,
      insert: runtime.insert,
      setProp: runtime.setProp,
      ...(onCleanup && { onCleanup }),
    };
  } catch (error) {
    console.warn('[owflow] Failed to import @opentui/solid', error);
    return JSON.parse('null') as null;
  }
};
