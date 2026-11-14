import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDefaultEnvironmentConfig, type EnvironmentConfig } from '../utils/environment-config.js';

export * from '../types/hook-types.js';
export {
  DEFAULT_MAX_LOG_RECORDS,
  MAX_LOG_TAIL_READ_BYTES,
  readHookLogRecords,
  readHookStatusSnapshot,
  readSessionHookLogs,
  readSessionLatestLogs,
  type ReadSessionHookLogsOptions,
} from './hooks-log-reader.js';

export const STATUS_FILE_ENV = 'OWFLOW_HOOKS_STATUS_FILE';
export const LOG_FILE_ENV = 'OWFLOW_HOOK_LOGS_FILE';

const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;
const ROTATION_MEGABYTES = 4;
const DEFAULT_LOG_ROTATION_BYTES = ROTATION_MEGABYTES * BYTES_PER_MEGABYTE;

const WORKSPACE_KEY_LENGTH = 16;
const DIRECTORY_PERMISSIONS = 0o700;
const LOG_FILE_PERMISSIONS = 0o600;

export const workspaceKey = (workspace: string): string => {
  let resolved = path.resolve(workspace);
  try {
    resolved = fs.realpathSync.native(resolved);
  } catch {
    // keep resolved path when workspace does not exist yet
  }
  return crypto
    .createHash('sha256')
    .update(process.platform === 'win32' ? resolved.toLowerCase() : resolved)
    .digest('hex')
    .slice(0, WORKSPACE_KEY_LENGTH);
};

export const getUserTemporaryDirectory = (
  config: EnvironmentConfig = createDefaultEnvironmentConfig(),
): string => {
  const uid = typeof process.getuid === 'function' ? String(process.getuid()) : config.username;
  return path.join(os.tmpdir(), `opencode-${uid}`);
};

export { getUserTemporaryDirectory as getUserTmpDir };

export const resolveHooksStatusFile = (
  workspace: string,
  config: EnvironmentConfig = createDefaultEnvironmentConfig(),
): string =>
  config.statusFilePath ??
  path.join(getUserTemporaryDirectory(config), `owflow-hooks-${workspaceKey(workspace)}.json`);

const trimHyphens = (text: string): string => {
  let start = 0;
  while (start < text.length && text[start] === '-') {
    start += 1;
  }
  let end = text.length;
  while (end > start && text[end - 1] === '-') {
    end -= 1;
  }
  return text.slice(start, end);
};

const sanitizeHookStem = (hookName?: string): string => {
  if (!hookName) {
    return '';
  }
  const cleaned = trimHyphens(path.basename(hookName).replaceAll(/[^a-z0-9-]/gi, '-'));
  return cleaned.length > 0 ? `-${cleaned}` : '';
};

export const resolveHooksLogFile = (workspace: string, hookName?: string): string => {
  const config = createDefaultEnvironmentConfig();
  return (
    config.logFilePath ??
    path.join(
      getUserTemporaryDirectory(config),
      `owflow-hook-logs-${workspaceKey(workspace)}${sanitizeHookStem(hookName)}.jsonl`,
    )
  );
};

export const resolveHooksLatestSymlink = (workspace: string, targetLogFile?: string): string => {
  const symlinkPath = path.join(getUserTemporaryDirectory(), `owflow-hooks-latest-${workspaceKey(workspace)}.jsonl`);
  const target = targetLogFile ?? resolveHooksLogFile(workspace);
  try {
    fs.mkdirSync(path.dirname(symlinkPath), { recursive: true, mode: DIRECTORY_PERMISSIONS });
    try {
      const stat = fs.lstatSync(symlinkPath);
      if (stat.isSymbolicLink() || stat.isFile()) {
        fs.unlinkSync(symlinkPath);
      }
    } catch {
      // ignore unlink errors
    }
    fs.symlinkSync(target, symlinkPath);
  } catch {
    // Graceful fallback for non-admin Windows or filesystem restrictions
  }
  return symlinkPath;
};

const rotateLogFileIfNecessary = (filePath: string, maxBytes: number): void => {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || stat.size <= maxBytes) {
      return;
    }
    const backupFile = `${filePath}.1`;
    try {
      const rotStat = fs.lstatSync(backupFile);
      if (rotStat.isSymbolicLink()) {
        fs.unlinkSync(backupFile);
      }
    } catch {
      // ignore backup unlink errors
    }
    fs.renameSync(filePath, backupFile);
  } catch (error: unknown) {
    const errorRecord = error as { code?: string } | undefined;
    if (errorRecord?.code !== 'ENOENT') {
      return;
    }
  }
};

export interface AppendLogOptions {
  readonly filePath: string;
  readonly line: string;
  readonly maxBytes?: number;
}

const resolveAppendArguments = (
  pathOrOptions: string | AppendLogOptions,
  rest: readonly (string | number | undefined)[],
): AppendLogOptions => {
  if (typeof pathOrOptions === 'object') {
    return pathOrOptions;
  }
  const line = typeof rest[0] === 'string' ? rest[0] : '';
  const maxBytes = typeof rest[1] === 'number' ? rest[1] : DEFAULT_LOG_ROTATION_BYTES;
  return { filePath: pathOrOptions, line, maxBytes };
};

export const appendWithRotation = (
  pathOrOptions: string | AppendLogOptions,
  ...rest: readonly (string | number | undefined)[]
): void => {
  const { filePath, line, maxBytes = DEFAULT_LOG_ROTATION_BYTES } = resolveAppendArguments(
    pathOrOptions,
    rest,
  );
  if (!line) {
    return;
  }
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: DIRECTORY_PERMISSIONS });
    rotateLogFileIfNecessary(filePath, maxBytes);

    const content = line.endsWith('\n') ? line : `${line}\n`;
    const flags =
      fs.constants.O_WRONLY |
      fs.constants.O_CREAT |
      fs.constants.O_APPEND |
      (fs.constants.O_NOFOLLOW ?? 0);
    const fileDescriptor = fs.openSync(filePath, flags, LOG_FILE_PERMISSIONS);
    try {
      fs.writeFileSync(fileDescriptor, content, 'utf8');
    } finally {
      fs.closeSync(fileDescriptor);
    }
  } catch {
    // Best-effort log persistence never affects hook execution.
  }
};

export interface CrashLogOptions {
  readonly workspace: string;
  readonly source: string;
  readonly error: unknown;
}

const resolveCrashLogOptions = (
  optionsOrWorkspace: string | CrashLogOptions,
  rest: readonly [source?: string, error?: unknown] | [],
): CrashLogOptions => {
  if (typeof optionsOrWorkspace === 'object') {
    return optionsOrWorkspace;
  }
  const source = rest[0] ?? '';
  const error = rest[1];
  return { workspace: optionsOrWorkspace, source, error };
};

export const writeHookCrashLog = (
  optionsOrWorkspace: string | CrashLogOptions,
  ...rest: readonly [source?: string, error?: unknown] | []
): void => {
  const { workspace, source, error } = resolveCrashLogOptions(optionsOrWorkspace, rest);
  try {
    const crashFile = path.join(getUserTemporaryDirectory(), 'owflow-hooks-crash.log');
    const timestamp = new Date().toISOString();
    const errorString = error instanceof Error ? (error.stack ?? error.message) : String(error);
    const entry = `[${timestamp}] [${source}] [workspace: ${workspace}]\n${errorString}\n\n`;
    appendWithRotation(crashFile, entry);
  } catch {
    // Best-effort crash logging never throws
  }
};
