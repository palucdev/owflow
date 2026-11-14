import fs from 'node:fs';
import path from 'node:path';
import type { HookRunLogRecord, HookRuntimeEntry, HookStatusSnapshot } from '../../types/hook-types.js';
import { appendWithRotation, resolveHooksLatestSymlink, resolveHooksLogFile, resolveHooksStatusFile } from '../hooks-persistence.js';

export const STATUS_DEBOUNCE_MS = 50;

const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;
const LOG_FILE_MEGABYTES = 4;
export const MAX_LOG_FILE_BYTES = LOG_FILE_MEGABYTES * BYTES_PER_MEGABYTE;

const NON_SESSION_STREAM_CAP_KILOBYTES = 16;
export const NON_SESSION_STREAM_CAP_BYTES = NON_SESSION_STREAM_CAP_KILOBYTES * BYTES_PER_KILOBYTE;

const DIRECTORY_PERMISSIONS = 0o700;
const STATUS_FILE_PERMISSIONS = 0o600;
const MAX_RUN_RECORDS = 1000;

export interface StatusRecorderOptions {
  directory: string;
  statusFile?: string;
  logFile?: string;
}

export interface FlushStatusAtomicOptions {
  readonly file: string;
  readonly workspace: string;
  readonly hooks: ReadonlyMap<string, HookRuntimeEntry>;
}

const resolveFlushOptions = (
  fileOrOptions: string | FlushStatusAtomicOptions,
  rest: readonly [workspace?: string, hooks?: ReadonlyMap<string, HookRuntimeEntry>] | [],
): FlushStatusAtomicOptions => {
  if (typeof fileOrOptions === 'object') {
    return fileOrOptions;
  }
  const workspace = rest[0] ?? '';
  const hooks = rest[1] ?? new Map<string, HookRuntimeEntry>();
  return { file: fileOrOptions, workspace, hooks };
};

export class StatusRecorder {
  private readonly statuses = new Map<string, HookRuntimeEntry>();
  private readonly writtenRunRecords = new Set<string>();
  private statusTimer: ReturnType<typeof setTimeout> | undefined;
  readonly statusFile: string;
  readonly logFile?: string;
  readonly directory: string;

  constructor(options: StatusRecorderOptions) {
    this.directory = options.directory;
    this.statusFile = options.statusFile ?? resolveHooksStatusFile(options.directory);
    this.logFile = options.logFile;
    resolveHooksLatestSymlink(this.directory);
    this.flushStatus();
  }

  getStatus(event: string): HookRuntimeEntry | undefined {
    return this.statuses.get(event);
  }

  setStatus(event: string, entry: HookRuntimeEntry): void {
    this.statuses.set(event, entry);
  }

  deleteStatus(event: string): void {
    this.statuses.delete(event);
  }

  getAllStatuses(): ReadonlyMap<string, HookRuntimeEntry> {
    return this.statuses;
  }

  flushStatusFileAtomic(
    fileOrOptions: string | FlushStatusAtomicOptions,
    ...rest: readonly [workspace?: string, hooks?: ReadonlyMap<string, HookRuntimeEntry>] | []
  ): void {
    const { file, workspace, hooks } = resolveFlushOptions(fileOrOptions, rest);
    const nonce = crypto.randomUUID();
    const temporaryFile = `${file}.${process.pid}.${nonce}.tmp`;

    try {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: DIRECTORY_PERMISSIONS });

      try {
        if (fs.lstatSync(file).isSymbolicLink()) {
          return;
        }
      } catch (error: unknown) {
        const errorRecord = error as { code?: string } | undefined;
        if (errorRecord?.code !== 'ENOENT') {
          return;
        }
      }

      const snapshot: HookStatusSnapshot = {
        version: 1,
        pid: process.pid,
        workspace,
        updatedAt: Date.now(),
        hooks: Object.fromEntries(hooks),
      };

      const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | (fs.constants.O_NOFOLLOW ?? 0);
      const fileDescriptor = fs.openSync(temporaryFile, flags, STATUS_FILE_PERMISSIONS);
      try {
        fs.writeFileSync(fileDescriptor, JSON.stringify(snapshot), { encoding: 'utf8' });
      } finally {
        fs.closeSync(fileDescriptor);
      }
      fs.renameSync(temporaryFile, file);
    } catch {
      fs.unlinkSync(temporaryFile);
      // Best-effort status persistence never affects hook execution.
    }
  };

  flushStatus(): void {
    if (this.statusTimer !== undefined) {
      clearTimeout(this.statusTimer);
      this.statusTimer = undefined;
    }
    this.flushStatusFileAtomic(this.statusFile, this.directory, this.statuses);
  }

  schedulePendingStatus(): void {
    if (this.statusTimer !== undefined) {
      clearTimeout(this.statusTimer);
    }
    this.statusTimer = setTimeout(() => {
      this.statusTimer = undefined;
      this.flushStatusFileAtomic(this.statusFile, this.directory, this.statuses);
    }, STATUS_DEBOUNCE_MS);
    this.statusTimer.unref?.();
  }

  appendLog(record: HookRunLogRecord): void {
    try {
      // Distinguish distinct runs by runId and terminal status
      const recordKey = `${record.runId}:${record.status}`;
      if (this.writtenRunRecords.has(recordKey)) {
        return;
      }

      const targetLogFile = this.logFile ?? resolveHooksLogFile(this.directory, record.name);
      appendWithRotation(targetLogFile, JSON.stringify(record));
      if (!this.logFile) {
        resolveHooksLatestSymlink(this.directory, targetLogFile);
      }
      this.writtenRunRecords.add(recordKey);

      // Bounded set eviction to prevent memory growth across thousands of runs
      if (this.writtenRunRecords.size > MAX_RUN_RECORDS) {
        const oldest = this.writtenRunRecords.values().next().value;
        if (oldest) {
          this.writtenRunRecords.delete(oldest);
        }
      }
    } catch {
      // Best-effort log persistence never affects hook execution.
    }
  }

  dispose(): void {
    this.flushStatus();
  }
}
