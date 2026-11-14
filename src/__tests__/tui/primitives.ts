import type { TuiPluginApi } from '@opencode-ai/plugin/tui';
import { HookRunState, type HookRunLogRecord } from '../../hooks/hooks-persistence.js';
import type { SidebarTheme, SolidRuntime } from '../../tui/primitives.js';

export interface FakeProperties {
  readonly content?: string;
  readonly onMouseUp?: () => void;
  readonly onMouseOver?: () => void;
  readonly onMouseOut?: () => void;
  readonly [propertyName: string]: unknown;
}

export interface FakeNode {
  tag: string;
  props: FakeProperties;
  children: (FakeNode | string)[];
}

export interface FakeSlotRegistration {
  order?: number;
  slots: {
    sidebar_content: (context: { readonly theme: { readonly current: SidebarTheme } }, properties?: { readonly session_id?: string }) => FakeNode;
  };
}

export interface FakeDialogCall {
  render: () => FakeNode;
  onClose?: () => void;
}

export interface FakeApi {
  slots: { register: (registration: FakeSlotRegistration) => string };
  theme: { current: SidebarTheme };
  state: { path: { directory: string } };
  renderer: { width: number; height: number; requestRender: () => void };
  lifecycle: { onDispose: (callback: () => void) => () => void };
  ui: {
    Dialog: (properties: unknown) => unknown;
    dialog: {
      replace: (render: () => FakeNode, onClose?: () => void) => void;
      setSize: () => void;
      clear: () => void;
    };
    toast: (input: unknown) => void;
  };
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

export const makeSolid = () => {
  const roots: FakeNode[] = [];
  const cleanups: (() => void)[] = [];
  const runtime: SolidRuntime = {
    createElement: (tag: string): FakeNode => {
      const node: FakeNode = { tag, props: {}, children: [] };
      if (tag === 'box') roots.push(node);
      return node;
    },
    insert: (parent: unknown, child: unknown) => {
      (parent as FakeNode).children.push(child as FakeNode);
    },
    setProp: (node: unknown, ...nameAndValue: [string, unknown]) => {
      const [propertyName, propertyValue] = nameAndValue;
      (node as FakeNode).props[propertyName] = propertyValue;
    },
    onCleanup: (cleanupFunction: () => void) => {
      cleanups.push(cleanupFunction);
    },
  };
  const triggerCleanup = (): void => {
    while (cleanups.length > 0) {
      const cleanupFunction = cleanups.shift();
      cleanupFunction?.();
    }
  };
  return { runtime, roots, cleanups, triggerCleanup };
};

const noop = (): void => {};

const createFakeUi = (dialogCalls: FakeDialogCall[], toasts: unknown[]): FakeApi['ui'] => ({
  Dialog: (properties: unknown) => properties,
  dialog: {
    replace: (render: () => FakeNode, onClose?: () => void) => {
      dialogCalls.push({ render, onClose });
    },
    setSize: noop,
    clear: noop,
  },
  toast: (input: unknown) => {
    toasts.push(input);
  },
});

export const makeFakeApi = (directory: string) => {
  const slots: FakeSlotRegistration[] = [];
  const dialogCalls: FakeDialogCall[] = [];
  const toasts: unknown[] = [];
  const disposeCallbacks: (() => void)[] = [];
  let renderCount = 0;

  const api: FakeApi = {
    slots: {
      register: (registration: FakeSlotRegistration) => {
        slots.push(registration);
        return 'owflow:0';
      },
    },
    theme: { current: THEME },
    state: { path: { directory } },
    renderer: {
      width: 120,
      height: 40,
      requestRender: () => {
        renderCount += 1;
      },
    },
    lifecycle: {
      onDispose: (callback: () => void) => {
        disposeCallbacks.push(callback);
        return noop;
      },
    },
    ui: createFakeUi(dialogCalls, toasts),
  };

  function getRenders(): number {
    return renderCount;
  }

  return {
    api: api as unknown as TuiPluginApi,
    fakeApi: api,
    slots,
    dialogCalls,
    toasts,
    disposeCallbacks,
    getRenders,
  };
};

export const collectText = (node: FakeNode | string): string => {
  if (typeof node === 'string') return node;
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
    if (found) return found;
  }
  return undefined;
};

export const makeLogRecord = (overrides: Partial<HookRunLogRecord> = {}): HookRunLogRecord => ({
  version: 1,
  runId: 'tool.execute.before#1',
  pid: 1,
  workspace: '/project',
  event: 'tool.execute.before',
  hook: '/project/.owflow/hooks/tool-execute-before.sh',
  name: 'tool-execute-before',
  startedAt: 12_345,
  finishedAt: 12_468,
  durationMs: 123,
  status: HookRunState.SUCCESS,
  ...overrides,
});

export const wait = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));
