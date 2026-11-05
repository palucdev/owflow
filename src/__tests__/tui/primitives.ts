import { HookRunState, type HookRunLogRecord } from '../../hooks/hook-logs.js';
import type { SidebarTheme } from '../../tui/primitives.js';

export interface FakeNode {
  tag: string;
  props: Record<string, any>;
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

export const makeSolid = () => {
  const roots: FakeNode[] = [];
  const runtime = {
    createElement: (tag: string): FakeNode => {
      const node: FakeNode = { tag, props: {}, children: [] };
      if (tag === 'box') roots.push(node);
      return node;
    },
    insert: (parent: any, child: any) => {
      parent.children.push(child);
    },
    setProp: (node: any, name: string, value: any) => {
      node.props[name] = value;
    },
  };
  return { runtime, roots };
};

export const makeFakeApi = (directory: string) => {
  const slots: any[] = [];
  const dialogCalls: Array<{ render: () => any; onClose?: () => void }> = [];
  const toasts: any[] = [];
  const disposeCallbacks: (() => void)[] = [];
  let renders = 0;

  const api: any = {
    slots: {
      register: (registration: any) => {
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
        renders += 1;
      },
    },
    lifecycle: {
      onDispose: (callback: () => void) => {
        disposeCallbacks.push(callback);
        return () => {};
      },
    },
    ui: {
      Dialog: (props: any) => props,
      dialog: {
        replace: (render: () => any, onClose?: () => void) => {
          dialogCalls.push({ render, onClose });
        },
        setSize: () => {},
        clear: () => {},
      },
      toast: (input: any) => {
        toasts.push(input);
      },
    },
  };

  return {
    api,
    slots,
    dialogCalls,
    toasts,
    disposeCallbacks,
    getRenders: () => renders,
  };
};

export const collectText = (node: FakeNode | string): string => {
  if (typeof node === 'string') return node;
  const content = typeof node.props.content === 'string' ? node.props.content : '';
  return [content, ...node.children.map(collectText)].filter(Boolean).join('\n');
};

export const findClickableByContent = (node: FakeNode, text: string): FakeNode | undefined => {
  if (typeof node.props.onMouseUp === 'function' && collectText(node).includes(text)) {
    return node;
  }
  for (const child of node.children) {
    if (typeof child === 'object') {
      const found = findClickableByContent(child, text);
      if (found) return found;
    }
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
  startedAt: 1_000,
  finishedAt: 1_123,
  durationMs: 123,
  status: HookRunState.SUCCESS,
  ...overrides,
});

export const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
