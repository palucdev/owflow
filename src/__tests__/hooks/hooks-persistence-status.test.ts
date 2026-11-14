import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  appendWithRotation,
  getUserTemporaryDirectory,
  readHookStatusSnapshot,
  resolveHooksLatestSymlink,
  resolveHooksLogFile,
  resolveHooksStatusFile,
  workspaceKey,
  writeHookCrashLog,
} from '../../hooks/hooks-persistence.js';
import type { EnvironmentConfig } from '../../utils/environment-config.js';
import * as environmentConfig from '../../utils/environment-config.js';
import type { HookStatusSnapshot } from '../../types/hook-types.js';
import { cleanupWorkspaces, createWorkspace } from './hooks-test-helpers.js';

const SMALL_LOG_CAP_BYTES = 20;
const LARGE_LOG_CONTENT_LENGTH = 50;
const WORKSPACE_HASH_PATTERN = /owflow-hooks-latest-[a-f0-9]{16}\.jsonl$/;
const INVALID_STATUS_VERSION = 2;
const SNAPSHOT_UPDATED_AT = 12_345;
const SNAPSHOT_PID = 1234;

const spyOnEnvironmentConfig = (overrides: Partial<EnvironmentConfig>) =>
  spyOn(environmentConfig, 'createDefaultEnvironmentConfig').mockReturnValue(environmentConfig.createTestEnvironmentConfig(overrides));

const expectDefaultResolvedPaths = (workspace: string, userDirectory: string): void => {
  expect(resolveHooksStatusFile(workspace)).toContain(userDirectory);
  expect(resolveHooksStatusFile(workspace)).toContain('owflow-hooks-');
  expect(resolveHooksLogFile(workspace)).toContain(userDirectory);
  expect(resolveHooksLogFile(workspace)).toContain('owflow-hook-logs-');
};

const expectPerHookLogFileName = (workspace: string, userDirectory: string): void => {
  expect(resolveHooksLogFile(workspace, 'tool-execute-before')).toBe(
    path.join(userDirectory, `owflow-hook-logs-${workspaceKey(workspace)}-tool-execute-before.jsonl`),
  );
  expect(resolveHooksLogFile(workspace)).toBe(path.join(userDirectory, `owflow-hook-logs-${workspaceKey(workspace)}.jsonl`));
};

afterEach(cleanupWorkspaces);

describe('hooks-persistence default path resolution', () => {
  test('resolveHooksStatusFile and resolveHooksLogFile resolve default and overridden paths', () => {
    const workspace = createWorkspace('owflow-hook-logs-unit-');
    const userDirectory = getUserTemporaryDirectory();
    expect(userDirectory).toMatch(/opencode-.+/);
    expectDefaultResolvedPaths(workspace, userDirectory);
    expectPerHookLogFileName(workspace, userDirectory);

    const nonExistent = path.join(workspace, 'does-not-exist');
    expectDefaultResolvedPaths(nonExistent, userDirectory);
    expect(resolveHooksLogFile(nonExistent, 'chat-message')).toBe(
      path.join(userDirectory, `owflow-hook-logs-${workspaceKey(nonExistent)}-chat-message.jsonl`),
    );
  });
});

describe('hooks-persistence injected path resolution', () => {
  test('resolveHooksStatusFile and resolveHooksLogFile honor injected configuration paths', () => {
    const workspace = createWorkspace('owflow-hook-logs-unit-');
    const overrideStatusFile = path.join(workspace, 'override-status.json');
    const overrideLogFile = path.join(workspace, 'override-log.jsonl');
    const configSpy = spyOnEnvironmentConfig({ statusFilePath: overrideStatusFile, logFilePath: overrideLogFile });

    try {
      expect(resolveHooksStatusFile(workspace)).toBe(overrideStatusFile);
      expect(resolveHooksLogFile(workspace)).toBe(overrideLogFile);
      expect(resolveHooksLogFile(workspace, 'tool-execute-before')).toBe(overrideLogFile);
    } finally {
      configSpy.mockRestore();
    }
  });
});

describe('readHookStatusSnapshot validation', () => {
  test('readHookStatusSnapshot handles missing, invalid, symlinks, directories, and valid files', () => {
    const workspace = createWorkspace('owflow-hook-logs-unit-');
    const statusFile = path.join(workspace, 'status.json');

    expect(readHookStatusSnapshot(statusFile)).toEqual({ kind: 'missing' });

    const directoryPath = path.join(workspace, 'status-dir');
    fs.mkdirSync(directoryPath);
    expect(readHookStatusSnapshot(directoryPath)).toEqual({ kind: 'invalid' });

    const invalidPayloads = [
      '{bad',
      JSON.stringify({ version: INVALID_STATUS_VERSION, hooks: {} }),
      '{"version":1,"hooks":null}',
      JSON.stringify({ version: 1, hooks: 'bad' }),
    ];
    for (const invalidPayload of invalidPayloads) {
      fs.writeFileSync(statusFile, invalidPayload);
      expect(readHookStatusSnapshot(statusFile)).toEqual({ kind: 'invalid' });
    }

    const validSnapshot: HookStatusSnapshot = {
      version: 1,
      pid: SNAPSHOT_PID,
      workspace,
      updatedAt: SNAPSHOT_UPDATED_AT,
      hooks: {},
    };
    fs.writeFileSync(statusFile, JSON.stringify(validSnapshot));
    expect(readHookStatusSnapshot(statusFile)).toEqual({ kind: 'ok', snapshot: validSnapshot });

    const symlinkStatus = path.join(workspace, 'sym-status.json');
    fs.symlinkSync(statusFile, symlinkStatus);
    expect(readHookStatusSnapshot(symlinkStatus)).toEqual({ kind: 'invalid' });
  });

  test('readHookStatusSnapshot returns cached results when mtime and size are unchanged', () => {
    const workspace = createWorkspace('owflow-hook-logs-unit-');
    const statusFile = path.join(workspace, 'cached-status.json');
    fs.writeFileSync(statusFile, JSON.stringify({ version: 1, pid: 1, workspace, updatedAt: 100, hooks: {} }));

    const firstStatus = readHookStatusSnapshot(statusFile);
    const secondStatus = readHookStatusSnapshot(statusFile);
    expect(firstStatus).toBe(secondStatus);
  });
});

const expectRotationBySize = (workspace: string): void => {
  const logFile = path.join(workspace, 'rot-test.log');

  appendWithRotation(logFile, 'line 1');
  appendWithRotation(logFile, 'line 2\n');
  expect(fs.readFileSync(logFile, 'utf8')).toBe('line 1\nline 2\n');

  appendWithRotation(logFile, '');
  expect(fs.readFileSync(logFile, 'utf8')).toBe('line 1\nline 2\n');

  appendWithRotation(logFile, 'line that pushes over cap', SMALL_LOG_CAP_BYTES);
  appendWithRotation(logFile, 'line after rotation', SMALL_LOG_CAP_BYTES);
  expect(fs.existsSync(`${logFile}.1`)).toBe(true);
  expect(fs.readFileSync(logFile, 'utf8')).toBe('line after rotation\n');
};

const expectSymlinkSafety = (workspace: string): void => {
  const targetFile = path.join(workspace, 'target.txt');
  const danglingLog = path.join(workspace, 'dangling.log');
  fs.symlinkSync(targetFile, danglingLog);
  appendWithRotation(danglingLog, 'malicious payload');
  expect(fs.existsSync(targetFile)).toBe(false);

  const largeLog = path.join(workspace, 'large.log');
  fs.writeFileSync(largeLog, 'x'.repeat(LARGE_LOG_CONTENT_LENGTH));
  const rotationSymlink = `${largeLog}.1`;
  fs.symlinkSync(targetFile, rotationSymlink);
  appendWithRotation(largeLog, 'chunk after rotation', SMALL_LOG_CAP_BYTES);
  expect(fs.lstatSync(rotationSymlink).isSymbolicLink()).toBe(false);
  expect(fs.existsSync(targetFile)).toBe(false);
};

describe('appendWithRotation', () => {
  test('appendWithRotation rotates files exceeding maxBytes and rejects dangling symlinks', () => {
    const workspace = createWorkspace('owflow-hook-logs-unit-');
    expectRotationBySize(workspace);
    expectSymlinkSafety(workspace);
  });
});

describe('writeHookCrashLog', () => {
  test('writeHookCrashLog writes formatted crash entries to owflow-hooks-crash.log', () => {
    const workspace = createWorkspace('owflow-hook-logs-unit-');
    const userDirectory = getUserTemporaryDirectory();
    const crashLogFile = path.join(userDirectory, 'owflow-hooks-crash.log');

    const error = new Error('test crash failure');
    writeHookCrashLog(workspace, 'test_source', error);

    expect(fs.existsSync(crashLogFile)).toBe(true);
    const content = fs.readFileSync(crashLogFile, 'utf8');
    expect(content).toContain('[test_source]');
    expect(content).toContain(`[workspace: ${workspace}]`);
    expect(content).toContain('test crash failure');

    writeHookCrashLog(workspace, 'string_source', 'raw string failure');
    const updated = fs.readFileSync(crashLogFile, 'utf8');
    expect(updated).toContain('[string_source]');
    expect(updated).toContain('raw string failure');
  });
});

describe('resolveHooksLatestSymlink targets', () => {
  test('resolveHooksLatestSymlink creates and resolves symlink pointing to active workspace log file', () => {
    const workspace = createWorkspace('owflow-hook-logs-unit-');
    const userDirectory = getUserTemporaryDirectory();
    const symlinkPath = resolveHooksLatestSymlink(workspace);

    const expectedName = `owflow-hooks-latest-${workspaceKey(workspace)}.jsonl`;
    expect(symlinkPath).toBe(path.join(userDirectory, expectedName));
    expect(symlinkPath).toMatch(WORKSPACE_HASH_PATTERN);
    expect(fs.lstatSync(symlinkPath).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(symlinkPath)).toBe(resolveHooksLogFile(workspace));

    const secondSymlinkPath = resolveHooksLatestSymlink(workspace);
    expect(secondSymlinkPath).toBe(symlinkPath);
    expect(fs.lstatSync(secondSymlinkPath).isSymbolicLink()).toBe(true);

    const targetFile = resolveHooksLogFile(workspace, 'tool-execute-before');
    const updatedSymlink = resolveHooksLatestSymlink(workspace, targetFile);
    expect(updatedSymlink).toBe(symlinkPath);
    expect(fs.readlinkSync(symlinkPath)).toBe(targetFile);
  });

  test('resolveHooksLatestSymlink maintains distinct symlinks across multiple workspaces without collision', () => {
    const firstWorkspace = createWorkspace('owflow-hook-logs-unit-');
    const secondWorkspace = createWorkspace('owflow-hook-logs-unit-');
    const firstSymlink = resolveHooksLatestSymlink(firstWorkspace);
    const secondSymlink = resolveHooksLatestSymlink(secondWorkspace);

    expect(firstSymlink).not.toBe(secondSymlink);
    expect(firstSymlink).toContain(`owflow-hooks-latest-${workspaceKey(firstWorkspace)}.jsonl`);
    expect(secondSymlink).toContain(`owflow-hooks-latest-${workspaceKey(secondWorkspace)}.jsonl`);
    expect(fs.lstatSync(firstSymlink).isSymbolicLink()).toBe(true);
    expect(fs.lstatSync(secondSymlink).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(firstSymlink)).toBe(resolveHooksLogFile(firstWorkspace));
    expect(fs.readlinkSync(secondSymlink)).toBe(resolveHooksLogFile(secondWorkspace));

    const firstSymlinkAgain = resolveHooksLatestSymlink(firstWorkspace);
    expect(firstSymlinkAgain).toBe(firstSymlink);
    expect(fs.readlinkSync(firstSymlinkAgain)).toBe(resolveHooksLogFile(firstWorkspace));
    expect(fs.readlinkSync(secondSymlink)).toBe(resolveHooksLogFile(secondWorkspace));
  });

  test('resolveHooksLatestSymlink handles filesystem symlink errors gracefully', () => {
    const workspace = createWorkspace('owflow-hook-logs-unit-');
    const symlinkSpy = spyOn(fs, 'symlinkSync').mockImplementation(() => {
      const symlinkError = new Error('EPERM: operation not permitted') as NodeJS.ErrnoException;
      symlinkError.code = 'EPERM';
      throw symlinkError;
    });
    try {
      const symlinkPath = resolveHooksLatestSymlink(workspace);
      expect(symlinkPath).toContain(`owflow-hooks-latest-${workspaceKey(workspace)}.jsonl`);
    } finally {
      symlinkSpy.mockRestore();
    }
  });
});
