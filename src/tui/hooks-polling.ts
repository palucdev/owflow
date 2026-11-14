import fs from 'node:fs';
import type { TuiPluginApi } from '@opencode-ai/plugin/tui';
import { readHookStatusSnapshot } from '../hooks/hooks-persistence.js';
import type { HookRuntimeEntry } from '../types/hook-types.js';
import { getActiveDialogHandle } from './hooks-dialogs.js';
import type { SidebarRenderHandle } from './hooks-sidebar.js';

const DEFAULT_STATUS_POLL_MS = 200;

export interface StatusPollingOptions {
  readonly api: TuiPluginApi;
  readonly statusFile: string;
  readonly handles: SidebarRenderHandle[];
  readonly statusContainer: { current: Map<string, HookRuntimeEntry> };
}

export const checkStatusFile = (
  statusFile: string,
  lastMtime: number | undefined,
): { statuses?: Map<string, HookRuntimeEntry>; mtime?: number } => {
  try {
    const stat = fs.statSync(statusFile);
    if (!stat.isFile()) {
      return { mtime: undefined };
    }
    if (lastMtime === stat.mtimeMs) {
      return { mtime: lastMtime };
    }
    const result = readHookStatusSnapshot(statusFile);
    const statuses = result.kind === 'ok' ? new Map(Object.entries(result.snapshot.hooks)) : undefined;
    return { statuses, mtime: stat.mtimeMs };
  } catch {
    return { mtime: undefined };
  }
};

export const setupStatusPolling = (options: StatusPollingOptions): void => {
  const { api, statusFile, handles, statusContainer } = options;
  const renderer = api.renderer;
  let lastMtime: number | undefined;

  const tick = (): void => {
    const { statuses, mtime } = checkStatusFile(statusFile, lastMtime);
    lastMtime = mtime;
    if (statuses) {
      statusContainer.current = statuses;
    }

    for (const handle of handles) {
      if (!handle.disposed() && handle.applyStatuses(statusContainer.current)) {
        renderer.requestRender();
      }
    }
    for (let index = handles.length - 1; index >= 0; index -= 1) {
      if (handles[index]!.disposed()) {
        handles.splice(index, 1);
      }
    }
  };

  const timer = setInterval(tick, DEFAULT_STATUS_POLL_MS);
  (timer as { unref?: () => void }).unref?.();
  api.lifecycle.onDispose(() => {
    clearInterval(timer);
    getActiveDialogHandle()?.dispose();
    for (const handle of handles) {
      handle.dispose();
    }
    handles.length = 0;
  });
};
