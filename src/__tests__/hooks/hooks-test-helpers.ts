import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HookLogReadResult, HookRunLogRecord, HookStatusReadResult } from '../../types/hook-types.js';

const trackedWorkspaces: string[] = [];

const DEFAULT_HOOK_SCRIPT = '#!/usr/bin/env bash\nexit 0\n';
const EXECUTABLE_FILE_MODE = 0o755;

export const createWorkspace = (prefix: string): string => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  trackedWorkspaces.push(workspace);
  return workspace;
};

export const cleanupWorkspaces = (): void => {
  for (const workspace of trackedWorkspaces.splice(0)) {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
};

export interface HookScriptOptions {
  readonly workspace: string;
  readonly fileName: string;
  readonly content?: string;
}

export const writeHookScript = (options: HookScriptOptions): string => {
  const hooksDirectory = path.join(options.workspace, '.owflow', 'hooks');
  fs.mkdirSync(hooksDirectory, { recursive: true });
  const scriptPath = path.join(hooksDirectory, options.fileName);
  fs.writeFileSync(scriptPath, options.content ?? DEFAULT_HOOK_SCRIPT, { mode: EXECUTABLE_FILE_MODE });
  return scriptPath;
};

export interface LogRecordOverrides extends Partial<Omit<HookRunLogRecord, 'workspace'>> {
  readonly workspace?: string;
}

const DEFAULT_STARTED_AT = 12_345;
const DEFAULT_FINISHED_AT = 12_395;
const DEFAULT_DURATION_MS = 50;

export const createLogRecord = (overrides: LogRecordOverrides = {}): HookRunLogRecord => ({
  version: 1,
  runId: 'tool.execute.before#1',
  pid: 1,
  workspace: '/workspace',
  event: 'tool.execute.before',
  hook: '/workspace/.owflow/hooks/tool-execute-before.sh',
  name: 'tool-execute-before',
  startedAt: DEFAULT_STARTED_AT,
  finishedAt: DEFAULT_FINISHED_AT,
  durationMs: DEFAULT_DURATION_MS,
  status: 'success',
  ...overrides,
});

export const writeLogRecords = (filePath: string, records: readonly HookRunLogRecord[]): void => {
  fs.writeFileSync(filePath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
};

export const expectOkLogResult = (result: HookLogReadResult): Extract<HookLogReadResult, { kind: 'ok' }> => {
  if (result.kind !== 'ok') {
    throw new TypeError(`expected an ok log result, received: ${result.kind}`);
  }
  return result;
};

export const expectOkStatusResult = (result: HookStatusReadResult): Extract<HookStatusReadResult, { kind: 'ok' }> => {
  if (result.kind !== 'ok') {
    throw new TypeError(`expected an ok status result, received: ${result.kind}`);
  }
  return result;
};
