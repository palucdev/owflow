import { spyOn } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as hookLogs from '../../hooks/hooks-persistence.js';
import { registerActiveHooksSidebar } from '../../tui.js';
import type { HookRunLogRecord, HookStatusSnapshot } from '../../types/hook-types.js';
import type { EnvironmentConfig } from '../../utils/environment-config.js';
import type { SidebarTheme, SolidRuntime } from '../../tui/primitives.js';
import { findClickableByContent, makeFakeApi, makeSolid, type FakeDialogCall, type FakeNode, type FakeSlotRegistration } from './primitives.js';

const trackedWorkspaces: string[] = [];

export interface DialogWorkspace {
  readonly root: string;
  readonly hooksDirectory: string;
}

export const createDialogWorkspace = (prefix: string): DialogWorkspace => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  trackedWorkspaces.push(root);
  const hooksDirectory = path.join(root, '.owflow', 'hooks');
  fs.mkdirSync(hooksDirectory, { recursive: true });
  return { root, hooksDirectory };
};

export const cleanupDialogWorkspaces = (): void => {
  for (const workspace of trackedWorkspaces.splice(0)) {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
};

export const writeHookFile = (workspace: DialogWorkspace, fileName: string): string => {
  const hookFile = path.join(workspace.hooksDirectory, fileName);
  fs.writeFileSync(hookFile, '');
  return hookFile;
};

export const writeStatusSnapshot = (filePath: string, snapshot: HookStatusSnapshot): void => {
  fs.writeFileSync(filePath, JSON.stringify(snapshot));
};

export const writeLogRecord = (filePath: string, record: HookRunLogRecord): void => {
  fs.writeFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');
};

export interface RegisteredSidebar {
  readonly slots: FakeSlotRegistration[];
  readonly dialogCalls: FakeDialogCall[];
  readonly resolveLogFileSpy: unknown;
  readonly disposeCallbacks: (() => void)[];
  readonly getRenders: () => number;
}

export interface RegisterSidebarOptions {
  readonly workspace: DialogWorkspace;
  readonly statusFile: string;
  readonly logFile: string;
  readonly runtime?: SolidRuntime;
  readonly config?: EnvironmentConfig;
}

export const registerSidebar = async (options: RegisterSidebarOptions): Promise<RegisteredSidebar> => {
  const { api, slots, dialogCalls, disposeCallbacks, getRenders } = makeFakeApi(options.workspace.root);
  const { runtime } = makeSolid();
  const resolveLogFileSpy = spyOn(hookLogs, 'resolveHooksLogFile').mockReturnValue(options.logFile);
  spyOn(hookLogs, 'resolveHooksStatusFile').mockReturnValue(options.statusFile);
  await registerActiveHooksSidebar({
    api,
    directory: options.workspace.root,
    loadSolid: async () => options.runtime ?? runtime,
    ...(options.config !== undefined && { config: options.config }),
  });
  return { slots, dialogCalls, resolveLogFileSpy, disposeCallbacks, getRenders };
};

export interface RenderSidebarOptions {
  readonly slots: FakeSlotRegistration[];
  readonly theme: SidebarTheme;
  readonly sessionID?: string;
}

export const renderSidebar = (options: RenderSidebarOptions): FakeNode =>
  options.slots[0]!.slots.sidebar_content(
    { theme: { current: options.theme } },
    options.sessionID === undefined ? undefined : { session_id: options.sessionID },
  );

export const clickNode = (node: FakeNode | undefined): void => {
  (node?.props.onMouseUp as (() => void) | undefined)?.();
};

export const hoverNode = (node: FakeNode | undefined): void => {
  node?.props.onMouseOver?.();
  node?.props.onMouseOut?.();
};

export const clickLabelledNode = (node: FakeNode, label: string): void => {
  clickNode(findClickableByContent(node, label));
};
