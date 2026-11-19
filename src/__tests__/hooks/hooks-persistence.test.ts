import { afterAll, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  appendWithRotation,
  getUserTmpDir as getUserTemporaryDirectory,
  resolveHooksLatestSymlink,
  resolveHooksLogFile,
  resolveHooksStatusFile,
  workspaceKey,
  writeHookCrashLog,
} from '../../hooks/hooks-persistence.js';
import { removeScratchDirectory } from '../fixtures/hooks/scratch-cleanup.js';
import { isSymlinkCreationSupported } from '../fixtures/hooks/platform-support.js';

const ROTATION_MAX_BYTES = 20;
const LARGE_LOG_BYTES = 50;
const SCRATCH_ROOT = path.join(process.cwd(), '.test-scratch', 'hooks-persistence');
const environment = Bun.env as Record<string, string | undefined>;

fs.rmSync(SCRATCH_ROOT, { recursive: true, force: true });
fs.mkdirSync(SCRATCH_ROOT, { recursive: true });

afterAll(() => {
  removeScratchDirectory(SCRATCH_ROOT);
});

test('resolveHooksStatusFile and resolveHooksLogFile resolve default paths', () => {
  const root = path.join(SCRATCH_ROOT, 'resolve-default-paths');
  const userDirectory = getUserTemporaryDirectory();
  expect(userDirectory).toMatch(/opencode-.+/);
  expect(resolveHooksStatusFile(root)).toContain(userDirectory);
  expect(resolveHooksStatusFile(root)).toContain('owflow-hooks-');
  expect(resolveHooksLogFile(root)).toContain(userDirectory);
  expect(resolveHooksLogFile(root)).toContain('owflow-hook-logs-');

  // Non-existent workspace still resolves
  const nonExistent = path.join(root, 'does-not-exist');
  expect(resolveHooksStatusFile(nonExistent)).toContain(userDirectory);
  expect(resolveHooksStatusFile(nonExistent)).toContain('owflow-hooks-');
  expect(resolveHooksLogFile(nonExistent)).toContain(userDirectory);
  expect(resolveHooksLogFile(nonExistent)).toContain('owflow-hook-logs-');
});

test('resolveHooksLogFile resolves per-hook log names and fallback without hookName', () => {
  const root = path.join(SCRATCH_ROOT, 'resolve-log-names');
  const userDirectory = getUserTemporaryDirectory();

  expect(resolveHooksLogFile(root, 'tool-execute-before')).toBe(
    path.join(userDirectory, `owflow-hook-logs-${workspaceKey(root)}-tool-execute-before.jsonl`),
  );
  expect(resolveHooksLogFile(root)).toBe(path.join(userDirectory, `owflow-hook-logs-${workspaceKey(root)}.jsonl`));

  const nonExistent = path.join(root, 'does-not-exist');
  expect(resolveHooksLogFile(nonExistent, 'chat-message')).toBe(
    path.join(userDirectory, `owflow-hook-logs-${workspaceKey(nonExistent)}-chat-message.jsonl`),
  );
});

test('resolve path functions honor environment overrides', () => {
  const root = path.join(SCRATCH_ROOT, 'env-overrides');
  const previousStatus = environment['OWFLOW_HOOKS_STATUS_FILE'];
  const previousLog = environment['OWFLOW_HOOK_LOGS_FILE'];
  const overrideStatus = path.join(SCRATCH_ROOT, 'override-status.json');
  const overrideLog = path.join(SCRATCH_ROOT, 'override-log.jsonl');
  environment['OWFLOW_HOOKS_STATUS_FILE'] = overrideStatus;
  environment['OWFLOW_HOOK_LOGS_FILE'] = overrideLog;
  try {
    expect(resolveHooksStatusFile(root)).toBe(overrideStatus);
    expect(resolveHooksLogFile(root)).toBe(overrideLog);
    expect(resolveHooksLogFile(root, 'tool-execute-before')).toBe(overrideLog);
  } finally {
    if (previousStatus === undefined) delete environment['OWFLOW_HOOKS_STATUS_FILE'];
    else environment['OWFLOW_HOOKS_STATUS_FILE'] = previousStatus;
    if (previousLog === undefined) delete environment['OWFLOW_HOOK_LOGS_FILE'];
    else environment['OWFLOW_HOOK_LOGS_FILE'] = previousLog;
  }
});

test('appendWithRotation appends newlines, ignores empty lines, and rotates files exceeding maxBytes', () => {
  const root = path.join(SCRATCH_ROOT, 'append-rotation');
  const logFile = path.join(root, 'rot-test.log');

  // Basic append with automatic newline
  appendWithRotation(logFile, 'line 1');
  appendWithRotation(logFile, 'line 2\n');
  expect(fs.readFileSync(logFile, 'utf8')).toBe('line 1\nline 2\n');

  // Empty or empty-like line does nothing
  appendWithRotation(logFile, '');
  expect(fs.readFileSync(logFile, 'utf8')).toBe('line 1\nline 2\n');

  // Rotation when file size exceeds maxBytes
  appendWithRotation(logFile, 'line that pushes over cap', ROTATION_MAX_BYTES);
  appendWithRotation(logFile, 'line after rotation', ROTATION_MAX_BYTES);
  expect(fs.existsSync(`${logFile}.1`)).toBe(true);
  expect(fs.readFileSync(logFile, 'utf8')).toBe('line after rotation\n');
});

test.skipIf(!isSymlinkCreationSupported)('appendWithRotation rejects dangling symlinks and replaces symlink rotation targets', () => {
  const root = path.join(SCRATCH_ROOT, 'symlink-rotation');
  fs.mkdirSync(root, { recursive: true });
  const targetFile = path.join(root, 'target.txt');
  const symLog = path.join(root, 'dangling.log');
  fs.symlinkSync(targetFile, symLog);
  appendWithRotation(symLog, 'malicious payload');
  expect(fs.existsSync(targetFile)).toBe(false);

  // Safe rotation target replacement when .1 is a symlink
  const largeLog = path.join(root, 'large.log');
  fs.writeFileSync(largeLog, 'x'.repeat(LARGE_LOG_BYTES));
  const rotationSymlink = `${largeLog}.1`;
  fs.symlinkSync(targetFile, rotationSymlink);
  appendWithRotation(largeLog, 'chunk after rotation', ROTATION_MAX_BYTES);
  expect(fs.lstatSync(rotationSymlink).isSymbolicLink()).toBe(false);
  expect(fs.existsSync(targetFile)).toBe(false);
});

test('writeHookCrashLog writes formatted crash entries to owflow-hooks-crash.log', async () => {
  const root = path.join(SCRATCH_ROOT, 'crash-log');
  const userDirectory = getUserTemporaryDirectory();
  const crashLogFile = path.join(userDirectory, 'owflow-hooks-crash.log');

  const error = new Error('test crash failure');
  writeHookCrashLog(root, 'test_source', error);

  const content = await Bun.file(crashLogFile).text();
  expect(content).toContain('[test_source]');
  expect(content).toContain(`[workspace: ${root}]`);
  expect(content).toContain('test crash failure');

  // String error variant
  writeHookCrashLog(root, 'string_source', 'raw string failure');
  const updated = await Bun.file(crashLogFile).text();
  expect(updated).toContain('[string_source]');
  expect(updated).toContain('raw string failure');
});

test.skipIf(!isSymlinkCreationSupported)('resolveHooksLatestSymlink creates and resolves symlink pointing to active workspace log file', () => {
  const root = path.join(SCRATCH_ROOT, 'latest-symlink');
  const symlinkPath = resolveHooksLatestSymlink(root);

  const expectedName = `owflow-hooks-latest-${workspaceKey(root)}.jsonl`;
  expect(symlinkPath).toBe(path.join(getUserTemporaryDirectory(), expectedName));
  expect(symlinkPath).toMatch(/owflow-hooks-latest-[a-f0-9]{16}\.jsonl$/);
  const expectedTarget = resolveHooksLogFile(root);
  appendWithRotation(expectedTarget, 'latest-symlink-seed');
  expect(fs.readlinkSync(symlinkPath)).toBe(expectedTarget);

  // Calling it again updates or preserves the symlink safely
  expect(resolveHooksLatestSymlink(root)).toBe(symlinkPath);

  // Calling it with a targetLogFile updates the symlink to that target
  const targetFile = resolveHooksLogFile(root, 'tool-execute-before');
  appendWithRotation(targetFile, 'latest-symlink-updated-seed');
  expect(resolveHooksLatestSymlink(root, targetFile)).toBe(symlinkPath);
  expect(fs.readlinkSync(symlinkPath)).toBe(targetFile);
});

test.skipIf(!isSymlinkCreationSupported)('resolveHooksLatestSymlink maintains distinct symlinks across multiple workspaces without collision', () => {
  const root1 = path.join(SCRATCH_ROOT, 'multi-symlink-one');
  const root2 = path.join(SCRATCH_ROOT, 'multi-symlink-two');
  const symlink1 = resolveHooksLatestSymlink(root1);
  const symlink2 = resolveHooksLatestSymlink(root2);

  expect(symlink1).not.toBe(symlink2);
  expect(symlink1).toContain(`owflow-hooks-latest-${workspaceKey(root1)}.jsonl`);
  expect(symlink2).toContain(`owflow-hooks-latest-${workspaceKey(root2)}.jsonl`);

  const target1 = resolveHooksLogFile(root1);
  const target2 = resolveHooksLogFile(root2);
  appendWithRotation(target1, 'multi-workspace-one-seed');
  appendWithRotation(target2, 'multi-workspace-two-seed');
  expect(fs.readlinkSync(symlink1)).toBe(target1);
  expect(fs.readlinkSync(symlink2)).toBe(target2);

  // Re-resolving workspace 1 does not affect workspace 2's symlink
  expect(resolveHooksLatestSymlink(root1)).toBe(symlink1);
  expect(fs.readlinkSync(symlink1)).toBe(target1);
  expect(fs.readlinkSync(symlink2)).toBe(target2);
});

test('resolveHooksLatestSymlink handles filesystem symlink errors gracefully', () => {
  const root = path.join(SCRATCH_ROOT, 'symlink-error');
  const symlinkSpy = spyOn(fs, 'symlinkSync').mockImplementation(() => {
    const error: Error & { code?: string } = new Error('EPERM: operation not permitted');
    error.code = 'EPERM';
    throw error;
  });
  try {
    const symlinkPath = resolveHooksLatestSymlink(root);
    expect(symlinkPath).toContain(`owflow-hooks-latest-${workspaceKey(root)}.jsonl`);
  } finally {
    symlinkSpy.mockRestore();
  }
});
