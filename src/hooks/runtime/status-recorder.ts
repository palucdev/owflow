import fs from 'node:fs';
import path from 'node:path';
import type { HookRunLogRecord, HookRuntimeEntry, HookStatusSnapshot } from '../../types/hook-types.js';
import { appendWithRotation, resolveHooksLatestSymlink, resolveHooksLogFile, resolveHooksStatusFile } from '../hooks-persistence.js';

export const STATUS_DEBOUNCE_MS = 50;
export const MAX_LOG_FILE_BYTES = 4 * 1024 * 1024;
export const NON_SESSION_STREAM_CAP_BYTES = 16 * 1024;

export interface StatusRecorderOptions {
  directory: string;
  statusFile?: string;
  logFile?: string;
}

export class StatusRecorder {
  readonly statusFile: string;
  readonly logFile?: string;
  readonly directory: string;
  private readonly statuses = new Map<string, HookRuntimeEntry>();
  private readonly writtenRunRecords = new Set<string>();
  private statusTimer: ReturnType<typeof setTimeout> | undefined;

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

  flushStatusFileAtomic = (file: string, workspace: string, hooks: ReadonlyMap<string, HookRuntimeEntry>): void => {
    const nonce = crypto.randomUUID();
    const tmpFile = `${file}.${process.pid}.${nonce}.tmp`;

    try {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });

      try {
        if (fs.lstatSync(file).isSymbolicLink()) return;
      } catch (err: any) {
        if (err?.code !== 'ENOENT') return;
      }

      const snapshot: HookStatusSnapshot = {
        version: 1,
        pid: process.pid,
        workspace,
        updatedAt: Date.now(),
        hooks: Object.fromEntries(hooks),
      };

      const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | (fs.constants.O_NOFOLLOW ?? 0);
      const fd = fs.openSync(tmpFile, flags, 0o600);
      try {
        fs.writeFileSync(fd, JSON.stringify(snapshot), { encoding: 'utf8' });
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tmpFile, file);
    } catch {
      fs.unlinkSync(tmpFile);
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
      if (this.writtenRunRecords.has(recordKey)) return;

      const targetLogFile = this.logFile ?? resolveHooksLogFile(this.directory, record.name);
      appendWithRotation(targetLogFile, JSON.stringify(record));
      if (!this.logFile) {
        resolveHooksLatestSymlink(this.directory, targetLogFile);
      }
      this.writtenRunRecords.add(recordKey);

      // Bounded set eviction to prevent memory growth across thousands of runs
      if (this.writtenRunRecords.size > 1000) {
        const oldest = this.writtenRunRecords.values().next().value;
        if (oldest) this.writtenRunRecords.delete(oldest);
      }
    } catch {
      // Best-effort log persistence never affects hook execution.
    }
  }

  dispose(): void {
    this.flushStatus();
  }
}
