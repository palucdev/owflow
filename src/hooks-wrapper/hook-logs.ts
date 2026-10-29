/**
 * Append-only per-workspace hook logs: one JSONL record per distinct settled
 * run. Consecutive runs with identical content are coalesced into the first
 * record so a persistent failure cannot flood the file.
 *
 * The status snapshot is intentionally separate: it is overwritten and
 * bounded, while this file accumulates history for the TUI popup and external
 * tools. All I/O is best-effort and must never affect hook execution.
 */

import fs from "node:fs";
import path from "node:path";

import {
  isHookEventName,
  type HookEventName,
  type HookLogReadResult,
  type HookRunLogRecord,
  type HookRunLogReport,
} from "../types/hook-types.js";
import { errorMessage, isRecord } from "./shared.js";
import {
  ensurePrivateDirectory,
  opencodeTmpDirectory,
  rejectSymlink,
  workspaceStatusKey,
} from "./status.js";

export const LOG_FILE_PREFIX = "owflow-hook-logs-";
export const LOG_FILE_EXTENSION = ".jsonl";
export const LOG_FILE_ENV = "OWFLOW_HOOK_LOGS_FILE";
export const MAX_CAPTURE_BYTES = 16 * 1024;
export const MAX_LOG_RECORD_BYTES = 32 * 1024;
export const MAX_LOG_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_LOG_READ_BYTES = 512 * 1024;

export const hooksLogFile = (workspace: string): string =>
  path.join(
    opencodeTmpDirectory(),
    `${LOG_FILE_PREFIX}${workspaceStatusKey(workspace)}${LOG_FILE_EXTENSION}`,
  );

/** Test/debug override; production uses the computed tmp path. */
export const resolveHooksLogFile = (workspace: string): string =>
  process.env[LOG_FILE_ENV] ?? hooksLogFile(workspace);

const truncateToBytes = (
  value: string,
  maxBytes: number,
): { readonly text: string; readonly truncated: boolean } => {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) {
    return { text: value, truncated: false };
  }
  const bytes = Buffer.from(value, "utf8");
  return {
    text: bytes.subarray(0, Math.max(0, maxBytes)).toString("utf8"),
    truncated: true,
  };
};

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isEvent = (value: unknown): value is HookEventName =>
  typeof value === "string" && isHookEventName(value);

const isLogRecord = (value: unknown): value is HookRunLogRecord => {
  if (!isRecord(value)) return false;
  if (value.version !== 1) return false;
  if (typeof value.runId !== "string") return false;
  if (!isNumber(value.pid)) return false;
  if (typeof value.workspace !== "string") return false;
  if (!isEvent(value.event)) return false;
  if (typeof value.hook !== "string") return false;
  if (typeof value.name !== "string") return false;
  if (value.class !== undefined && value.class !== "gate" && value.class !== "observe") {
    return false;
  }
  if (value.sessionID !== undefined && typeof value.sessionID !== "string") {
    return false;
  }
  if (!isNumber(value.startedAt) || !isNumber(value.finishedAt)) return false;
  if (!isNumber(value.durationMs)) return false;
  if (value.status !== "success" && value.status !== "failure") return false;
  if (
    value.outcome !== "ok" &&
    value.outcome !== "blocked" &&
    value.outcome !== "failed"
  ) {
    return false;
  }
  for (const key of ["reason", "stdout", "stderr"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "string") return false;
  }
  if (
    value.exitCode !== undefined &&
    value.exitCode !== null &&
    !isNumber(value.exitCode)
  ) {
    return false;
  }
  if (
    value.signal !== undefined &&
    value.signal !== null &&
    typeof value.signal !== "string"
  ) {
    return false;
  }
  if (value.truncated !== undefined && typeof value.truncated !== "boolean") {
    return false;
  }
  return true;
};

interface MutableLogRecord {
  version: 1;
  runId: string;
  pid: number;
  workspace: string;
  event: HookEventName;
  hook: string;
  name: string;
  class?: "gate" | "observe";
  sessionID?: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  status: "success" | "failure";
  outcome: "ok" | "blocked" | "failed";
  reason?: string;
  exitCode?: number | null;
  signal?: string | null;
  stdout?: string;
  stderr?: string;
  truncated?: boolean;
}

const buildRecord = (
  report: HookRunLogReport,
  workspace: string,
  pid: number,
): MutableLogRecord => {
  const capture = report.capture;
  let truncated = capture?.truncated === true;

  const captureField = (value: string | undefined): string | undefined => {
    if (value === undefined) return undefined;
    const capped = truncateToBytes(value, MAX_CAPTURE_BYTES);
    if (capped.truncated) truncated = true;
    return capped.text;
  };

  const stdout = captureField(capture?.stdout);
  const stderr = captureField(capture?.stderr);
  const reason = report.reason ?? report.outcome?.reason;

  return {
    version: 1,
    runId: report.runId,
    pid,
    workspace,
    event: report.entry.event,
    hook: report.entry.path,
    name: path.basename(
      report.entry.path,
      path.extname(report.entry.path),
    ),
    ...(report.sessionID !== undefined
      ? { sessionID: report.sessionID }
      : {}),
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    durationMs: Math.max(0, report.finishedAt - report.startedAt),
    status: report.outcome?.status === "ok" ? "success" : "failure",
    outcome: report.outcome?.status ?? "failed",
    ...(reason !== undefined ? { reason } : {}),
    ...(capture?.exitCode !== undefined
      ? { exitCode: capture.exitCode }
      : {}),
    ...(capture?.signal !== undefined ? { signal: capture.signal } : {}),
    ...(stdout !== undefined ? { stdout } : {}),
    ...(stderr !== undefined ? { stderr } : {}),
    ...(truncated ? { truncated: true } : {}),
  };
};

/**
 * Identity of a record's meaningful content. Volatile fields (run id, timing,
 * pid) are excluded so a hook that keeps failing the same way - or keeps
 * producing the same output - appends one line instead of flooding the file.
 * A new session or any changed outcome/reason/capture starts a new line.
 */
const coalesceKey = (record: MutableLogRecord): string =>
  JSON.stringify([
    record.event,
    record.hook,
    record.sessionID ?? null,
    record.status,
    record.outcome,
    record.reason ?? null,
    record.exitCode === undefined ? "absent" : record.exitCode,
    record.signal === undefined ? "absent" : record.signal,
    record.stdout ?? null,
    record.stderr ?? null,
    record.truncated === true,
  ]);

const fitRecord = (record: MutableLogRecord): MutableLogRecord => {
  const recordSize = (): number =>
    Buffer.byteLength(JSON.stringify(record), "utf8");

  while (recordSize() > MAX_LOG_RECORD_BYTES) {
    const candidates = (["stdout", "stderr"] as const)
      .filter((key) => record[key] !== undefined)
      .sort(
        (a, b) =>
          Buffer.byteLength(record[b] ?? "", "utf8") -
          Buffer.byteLength(record[a] ?? "", "utf8"),
      );
    const largest = candidates[0];
    if (largest === undefined) break;
    delete record[largest];
    record.truncated = true;
  }

  if (record.reason !== undefined) {
    let reason = record.reason;
    while (recordSize() > MAX_LOG_RECORD_BYTES) {
      record.truncated = true;
      const excess = recordSize() - MAX_LOG_RECORD_BYTES;
      const budget = Buffer.byteLength(reason, "utf8") - excess - 8;
      if (budget <= 0) {
        delete record.reason;
        break;
      }
      reason = truncateToBytes(reason, budget).text;
      record.reason = reason;
    }
  }

  return record;
};

export interface HookLogStore {
  record(report: HookRunLogReport): void;
  dispose(): void;
}

export interface HookLogStoreOptions {
  readonly file: string;
  readonly workspace?: string;
  readonly pid?: number;
  readonly append?: (file: string, data: string) => void;
  readonly maxFileBytes?: number;
}

const rotateIfNeeded = (file: string, maxFileBytes: number): void => {
  let size: number;
  try {
    size = fs.lstatSync(file).size;
  } catch {
    return;
  }
  if (size <= maxFileBytes) return;
  const backup = `${file}.1`;
  try {
    fs.rmSync(backup, { force: true });
  } catch {
    // A missing or undeletable backup must not stop the fresh append.
  }
  fs.renameSync(file, backup);
};

const defaultAppend = (
  file: string,
  data: string,
  maxFileBytes: number,
): void => {
  ensurePrivateDirectory(path.dirname(file));
  rejectSymlink(file);
  rejectSymlink(`${file}.1`);
  rotateIfNeeded(file, maxFileBytes);
  fs.appendFileSync(file, data, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(file, 0o600);
};

/**
 * Synchronous append-only writer. Failures are warned once and swallowed; a
 * hook run never observes log I/O errors.
 */
export const createHookLogStore = ({
  file,
  workspace = process.cwd(),
  pid = process.pid,
  append,
  maxFileBytes = MAX_LOG_FILE_BYTES,
}: HookLogStoreOptions): HookLogStore => {
  let writeFailureWarned = false;
  let lastCoalesceKey: string | undefined;

  const record = (report: HookRunLogReport): void => {
    try {
      const built = fitRecord(buildRecord(report, workspace, pid));
      const key = coalesceKey(built);
      if (key === lastCoalesceKey) return;
      const line = `${JSON.stringify(built)}\n`;
      if (append !== undefined) append(file, line);
      else defaultAppend(file, line, maxFileBytes);
      lastCoalesceKey = key;
    } catch (error) {
      if (!writeFailureWarned) {
        writeFailureWarned = true;
        console.warn(
          `[owflow] hooks: failed to write hook log file ${file}: ${errorMessage(error)}`,
        );
      }
    }
  };

  return {
    record,
    dispose: () => {},
  };
};

export const readHookLogRecords = (file: string): HookLogReadResult => {
  let descriptor: number | undefined;
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) return { kind: "invalid" };
    if (stat.size === 0) {
      return { kind: "ok", records: [], truncated: false };
    }

    const length = Math.min(stat.size, MAX_LOG_READ_BYTES);
    const truncated = stat.size > MAX_LOG_READ_BYTES;
    const buffer = Buffer.alloc(length);
    descriptor = fs.openSync(file, "r");
    let read = 0;
    while (read < length) {
      const chunk = fs.readSync(
        descriptor,
        buffer,
        read,
        length - read,
        stat.size - length + read,
      );
      if (chunk === 0) break;
      read += chunk;
    }

    let raw = buffer.subarray(0, read).toString("utf8");
    if (truncated) {
      const firstNewline = raw.indexOf("\n");
      raw = firstNewline === -1 ? "" : raw.slice(firstNewline + 1);
    }

    const records: HookRunLogRecord[] = [];
    for (const line of raw.split("\n")) {
      if (line.trim().length === 0) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (isLogRecord(parsed)) records.push(parsed);
      } catch {
        // A partial tail or a foreign line is skipped; neighbors stay usable.
      }
    }
    return { kind: "ok", records, truncated };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    return code === "ENOENT" ? { kind: "missing" } : { kind: "invalid" };
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Closing a read-only descriptor cannot change the result.
      }
    }
  }
};

/**
 * Latest settled run for one event; ties prefer the later line. `since` keeps
 * runs that started before the caller's session epoch out of the result, so an
 * old run cannot masquerade as the current session's latest run.
 */
export const readLatestHookLog = (
  file: string,
  event: HookEventName,
  since = Number.NEGATIVE_INFINITY,
): HookRunLogRecord | undefined => {
  const result = readHookLogRecords(file);
  if (result.kind !== "ok") return undefined;
  let latest: HookRunLogRecord | undefined;
  for (const record of result.records) {
    if (record.event !== event) continue;
    if (record.startedAt < since) continue;
    if (latest === undefined || record.finishedAt >= latest.finishedAt) {
      latest = record;
    }
  }
  return latest;
};
