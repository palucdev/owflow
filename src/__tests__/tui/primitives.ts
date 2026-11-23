import type { TuiPluginApi } from '@opencode-ai/plugin/tui';
import fs from 'node:fs';
import { HookEventName, HookRunState, type HookRunLogRecord } from '../../hooks/hooks-persistence.js';
import type { SidebarTheme, SolidRuntime } from '../../tui/primitives.js';

export interface FakeNode {
  tag: string;
  props: Record<string, unknown>;
  children: (FakeNode | string)[];
}

export const THEME: SidebarTheme = {
  text: 'text-color',
  textMuted: 'muted-color',
  primary: 'primary-color',
  selectedListItemText: 'selected-text-color',
  backgroundElement: 'bg-element-color',
  warning: 'warning-color',
  success: 'success-color',
  error: 'error-color',
};

export const noop = (): void => {};

export interface SolidFake {
  readonly runtime: SolidRuntime;
  readonly triggerCleanup: () => void;
}

export const makeSolid = (): SolidFake => {
  const cleanups: (() => void)[] = [];
  const runtime: SolidRuntime = {
    createElement: (tag: string): unknown => {
      const node: FakeNode = { tag, props: {}, children: [] };
      return node;
    },
    insert: (parent: unknown, child: unknown): unknown => {
      (parent as FakeNode).children.push(child as FakeNode | string);
      return parent;
    },
    setProp: (node: unknown, ...[name, value]: [string, unknown]): unknown => Object.assign((node as FakeNode).props, { [name]: value }),
    onCleanup: (cleanupFunction: () => void): void => {
      cleanups.push(cleanupFunction);
    },
  };
  const triggerCleanup = (): void => {
    while (cleanups.length > 0) {
      const cleanup = cleanups.shift();
      cleanup?.();
    }
  };
  return { runtime, triggerCleanup };
};

export interface FakeSlotRegistration {
  readonly order: number;
  readonly slots: {
    readonly sidebar_content: (
      slotContext: { readonly theme: { readonly current: SidebarTheme } },
      slotProperties?: { readonly session_id?: string },
    ) => unknown;
  };
}

export interface FakeDialogCall {
  readonly render: () => unknown;
  readonly onClose?: () => void;
}

const createFakeSlots = (): { readonly slots: FakeSlotRegistration[]; readonly register: (registration: FakeSlotRegistration) => string } => {
  const slots: FakeSlotRegistration[] = [];
  return {
    slots,
    register: (registration: FakeSlotRegistration): string => {
      slots.push(registration);
      return 'owflow:0';
    },
  };
};

const createFakeDialog = (): {
  readonly dialogCalls: FakeDialogCall[];
  readonly toasts: unknown[];
  readonly dialogApi: {
    readonly replace: (render: () => unknown, onClose?: () => void) => void;
    readonly setSize: () => void;
    readonly clear: () => void;
  };
  readonly toastApi: (input: unknown) => void;
} => {
  const dialogCalls: FakeDialogCall[] = [];
  const toasts: unknown[] = [];
  return {
    dialogCalls,
    toasts,
    dialogApi: {
      replace: (render: () => unknown, onClose?: () => void): void => {
        dialogCalls.push({ render, onClose });
      },
      setSize: noop,
      clear: noop,
    },
    toastApi: (input: unknown): void => {
      toasts.push(input);
    },
  };
};

const createFakeLifecycle = (): {
  readonly disposeCallbacks: (() => void)[];
  readonly lifecycleApi: { readonly onDispose: (callback: () => void) => () => void };
} => {
  const disposeCallbacks: (() => void)[] = [];
  return {
    disposeCallbacks,
    lifecycleApi: {
      onDispose: (callback: () => void): (() => void) => {
        disposeCallbacks.push(callback);
        return noop;
      },
    },
  };
};

const createFakeRenderer = (): {
  readonly renderer: { readonly width: number; readonly height: number; readonly requestRender: () => void };
  readonly getRenders: () => number;
} => {
  let renders = 0;
  return {
    renderer: {
      width: 120,
      height: 40,
      requestRender: (): void => {
        renders += 1;
      },
    },
    getRenders: (): number => renders,
  };
};

export interface FakeApi {
  readonly api: TuiPluginApi;
  readonly slots: FakeSlotRegistration[];
  readonly dialogCalls: FakeDialogCall[];
  readonly toasts: unknown[];
  readonly disposeCallbacks: (() => void)[];
  readonly getRenders: () => number;
}

export const makeFakeApi = (directory: string): FakeApi => {
  const { slots, register } = createFakeSlots();
  const { dialogCalls, toasts, dialogApi, toastApi } = createFakeDialog();
  const { disposeCallbacks, lifecycleApi } = createFakeLifecycle();
  const { renderer, getRenders } = createFakeRenderer();

  const api = {
    slots: { register },
    state: { path: { directory } },
    renderer,
    lifecycle: lifecycleApi,
    ui: { dialog: dialogApi, toast: toastApi },
  } as unknown as TuiPluginApi;

  return { api, slots, dialogCalls, toasts, disposeCallbacks, getRenders };
};

export const collectText = (node: FakeNode | string): string => {
  if (typeof node === 'string') {
    return node;
  }
  const content = typeof node.props.content === 'string' ? node.props.content : '';
  return [content, ...node.children.map((child) => collectText(child))].filter(Boolean).join('\n');
};

export const findClickableByContent = (node: FakeNode, text: string): FakeNode | undefined => {
  if (typeof node.props.onMouseUp === 'function' && collectText(node).includes(text)) {
    return node;
  }
  for (const child of node.children) {
    if (typeof child !== 'object') {
      continue;
    }
    const found = findClickableByContent(child, text);
    if (found) {
      return found;
    }
  }
  return undefined;
};

export const findScrollbox = (node: FakeNode): FakeNode | undefined =>
  node.children.find((child): child is FakeNode => typeof child === 'object' && child.tag === 'scrollbox');

export const hasScrollbox = (node: FakeNode): boolean => findScrollbox(node) !== undefined;

export const openDetailFor = (rendered: unknown, name: string): FakeNode => {
  const hookRow = findClickableByContent(rendered as FakeNode, name);
  if (hookRow === undefined) {
    throw new Error(`Expected clickable hook row '${name}' in the rendered sidebar`);
  }
  (hookRow.props.onMouseOver as (() => void) | undefined)?.();
  (hookRow.props.onMouseOut as (() => void) | undefined)?.();
  (hookRow.props.onMouseUp as () => void)();
  return hookRow;
};

export const openLogsFrom = (detail: FakeNode): FakeNode => {
  const viewLogsButton = findClickableByContent(detail, 'View logs');
  if (viewLogsButton === undefined) {
    throw new Error('Expected clickable "View logs" button in the detail popup');
  }
  (viewLogsButton.props.onMouseOver as (() => void) | undefined)?.();
  (viewLogsButton.props.onMouseOut as (() => void) | undefined)?.();
  (viewLogsButton.props.onMouseUp as () => void)();
  return viewLogsButton;
};

export interface StatusSnapshotEntry {
  readonly event: string;
  readonly status: string;
  readonly startedAt: number;
  readonly finishedAt?: number;
  readonly durationMs?: number;
  readonly reason?: string;
  readonly sessionID?: string;
  readonly exitCode?: number;
}

export const writeStatusSnapshot = (statusFile: string, entry: StatusSnapshotEntry): void => {
  const { event, ...entryFields } = entry;
  fs.writeFileSync(
    statusFile,
    JSON.stringify({ version: 1, pid: 1, workspace: '', updatedAt: entry.finishedAt ?? entry.startedAt, hooks: { [event]: entryFields } }),
    'utf8',
  );
};

export const makeLogRecord = (overrides: Partial<HookRunLogRecord> = {}): HookRunLogRecord => ({
  version: 1,
  runId: 'tool.execute.before#1',
  pid: 1,
  workspace: '/project',
  event: HookEventName.ToolExecuteBefore,
  hook: '/project/.owflow/hooks/tool-execute-before.sh',
  name: 'tool-execute-before',
  startedAt: 1000,
  finishedAt: 1123,
  durationMs: 123,
  status: HookRunState.SUCCESS,
  ...overrides,
});

export const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface SidebarRenderOptions {
  readonly slots: readonly FakeSlotRegistration[];
  readonly sessionID?: string;
}

export const renderSidebarSlot = (options: SidebarRenderOptions): FakeNode => {
  const { slots, sessionID } = options;
  const slotProperties = sessionID === undefined ? undefined : { session_id: sessionID };
  return slots[0]!.slots.sidebar_content({ theme: { current: THEME } }, slotProperties) as FakeNode;
};
