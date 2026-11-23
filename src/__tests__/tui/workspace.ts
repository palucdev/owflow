import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface TemporaryWorkspace {
  readonly temporaryDirectory: string;
  readonly hooksDirectory: string;
  readonly statusFile: string;
}

export interface WorkspaceHarness {
  readonly workspace: () => TemporaryWorkspace;
  readonly setup: () => void;
  readonly teardown: () => void;
}

const createTemporaryWorkspace = (directoryPrefix: string): TemporaryWorkspace => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), `owflow-${directoryPrefix}-test-`));
  const hooksDirectory = path.join(temporaryDirectory, '.owflow', 'hooks');
  fs.mkdirSync(hooksDirectory, { recursive: true });
  return { temporaryDirectory, hooksDirectory, statusFile: path.join(temporaryDirectory, 'status.json') };
};

export const createWorkspaceHarness = (directoryPrefix: string): WorkspaceHarness => {
  const active: { current?: TemporaryWorkspace } = {};
  return {
    workspace: (): TemporaryWorkspace => {
      const workspace = active.current;
      if (workspace === undefined) {
        throw new Error(`Temporary workspace '${directoryPrefix}' is only available inside a running test`);
      }
      return workspace;
    },
    setup: (): void => {
      active.current = createTemporaryWorkspace(directoryPrefix);
    },
    teardown: (): void => {
      const workspace = active.current;
      if (workspace !== undefined && fs.existsSync(workspace.temporaryDirectory)) {
        fs.rmSync(workspace.temporaryDirectory, { recursive: true, force: true });
      }
    },
  };
};
