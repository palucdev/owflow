/**
 * Live hook runtime status: the single overwritten snapshot written by the
 * dispatcher observer and read by the TUI poller. Platform-agnostic — the
 * transport is a JSON file in OpenCode's tmp directory so the server and TUI
 * processes do not need a shared runtime.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  HookRunState,
  HookRuntimeEntry,
  HookStatusReadResult,
  HookStatusReport,
  HookStatusSnapshot,
} from "../types/hook-types.js";
import { errorMessage, isRecord } from "./shared.js";

export const STATUS_FILE_PREFIX = "owflow-hooks-";
export const STATUS_FILE_EXTENSION = ".json";
export const STATUS_FILE_ENV = "OWFLOW_HOOKS_STATUS_FILE";
export const MAX_STATUS_FILE_BYTES = 64 * 1024;
export const DEFAULT_STATUS_FLUSH_MS = 50;

/** OpenCode creates this directory at startup; owflow only joins the path. */
export const opencodeTmpDirectory = (): string =>
  path.join(os.tmpdir(), "opencode");

const normalizeWorkspace = (workspace: string): string => {
  let normalized = path.resolve(workspace);
  try {
    normalized = fs.realpathSync.native(normalized);
  } catch {
    // The workspace may be virtual or missing; the resolved path is stable
    // enough for the hash, and status I/O must never fail on normalization.
  }
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
};

export const workspaceStatusKey = (workspace: string): string =>
  crypto
    .createHash("sha256")
    .update(normalizeWorkspace(workspace))
    .digest("hex")
    .slice(0, 16);

export const hooksStatusFile = (workspace: string): string =>
  path.join(
    opencodeTmpDirectory(),
    `${STATUS_FILE_PREFIX}${workspaceStatusKey(workspace)}${STATUS_FILE_EXTENSION}`,
  );

/** Test/debug override; production uses the computed tmp path. */
export const resolveHooksStatusFile = (workspace: string): string =>
  process.env[STATUS_FILE_ENV] ?? hooksStatusFile(workspace);

export const ensurePrivateDirectory = (directory: string): void => {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
};

export const rejectSymlink = (targetPath: string): void => {
  try {
    const stat = fs.lstatSync(targetPath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(
        `refusing to write non-regular file or symlink: ${targetPath}`,
      );
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") return;
    throw error;
  }
};

const writeAtomic = (file: string, data: string): void => {
  ensurePrivateDirectory(path.dirname(file));
  const temporary = `${file}.tmp`;
  rejectSymlink(file);
  rejectSymlink(temporary);
  fs.writeFileSync(temporary, data, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, file);
};

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isRuntimeEntry = (value: unknown): value is HookRuntimeEntry => {
  if (!isRecord(value)) return false;
  if (
    value.status !== "pending" &&
    value.status !== "success" &&
    value.status !== "failure"
  ) {
    return false;
  }
  if (!isNumber(value.startedAt)) return false;
  if (value.finishedAt !== undefined && !isNumber(value.finishedAt)) {
    return false;
  }
  if (value.durationMs !== undefined && !isNumber(value.durationMs)) {
    return false;
  }
  if (value.reason !== undefined && typeof value.reason !== "string") {
    return false;
  }
  return true;
};

const parseSnapshot = (raw: string): HookStatusSnapshot | undefined => {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  if (value.version !== 1) return undefined;
  if (!isNumber(value.pid) || typeof value.workspace !== "string") {
    return undefined;
  }
  if (!isNumber(value.updatedAt)) return undefined;
  if (!isRecord(value.hooks)) return undefined;

  const hooks: Record<string, HookRuntimeEntry> = {};
  for (const [event, entry] of Object.entries(value.hooks)) {
    if (!isRuntimeEntry(entry)) return undefined;
    hooks[event] = entry;
  }
  return {
    version: 1,
    pid: value.pid,
    workspace: value.workspace,
    updatedAt: value.updatedAt,
    hooks,
  };
};

/**
 * Reads the status snapshot without ever throwing. Oversized files are
 * rejected before reading; malformed content keeps the TUI on its last good
 * state.
 */
export const readHookStatusSnapshot = (
  file: string,
): HookStatusReadResult => {
  try {
    const stat = fs.lstatSync(file);
    if (
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      stat.size > MAX_STATUS_FILE_BYTES
    ) {
      return { kind: "invalid" };
    }
    const raw = fs.readFileSync(file, "utf8");
    if (Buffer.byteLength(raw, "utf8") > MAX_STATUS_FILE_BYTES) {
      return { kind: "invalid" };
    }
    const snapshot = parseSnapshot(raw);
    return snapshot === undefined
      ? { kind: "invalid" }
      : { kind: "ok", snapshot };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    return code === "ENOENT" ? { kind: "missing" } : { kind: "invalid" };
  }
};

export interface HookStatusStore {
  observe(report: HookStatusReport): void;
  snapshot(): HookStatusSnapshot;
  flushNow(): void;
  dispose(): void;
}

export interface HookStatusStoreOptions {
  readonly file: string;
  readonly workspace?: string;
  readonly now?: () => number;
  readonly flushMs?: number;
  readonly write?: (file: string, data: string) => void;
}

interface EventRuntime {
  status: HookRunState;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  reason?: string;
  /** The last visible outcome, restored when a silent run clears its pending. */
  lastSettled?: HookRuntimeEntry;
  readonly active: Set<string>;
  readonly starts: Map<string, number>;
}

const copyRuntime = (runtime: EventRuntime): HookRuntimeEntry => ({
  status: runtime.status,
  startedAt: runtime.startedAt,
  ...(runtime.finishedAt !== undefined
    ? { finishedAt: runtime.finishedAt }
    : {}),
  ...(runtime.durationMs !== undefined
    ? { durationMs: runtime.durationMs }
    : {}),
  ...(runtime.reason !== undefined ? { reason: runtime.reason } : {}),
});

const earliestStart = (runtime: EventRuntime): number => {
  let earliest = Number.POSITIVE_INFINITY;
  for (const start of runtime.starts.values()) {
    if (start < earliest) earliest = start;
  }
  return Number.isFinite(earliest) ? earliest : runtime.startedAt;
};

/**
 * In-memory status store with a dirty-flag, trailing 50 ms flush. Writes are
 * best-effort: a failure is warned once and never reaches hook execution.
 *
 * Run IDs pair concurrent pending/settled reports so a late success cannot
 * overwrite a still-pending sibling run of the same event.
 */
export const createHookStatusStore = ({
  file,
  workspace = process.cwd(),
  now = Date.now,
  flushMs = DEFAULT_STATUS_FLUSH_MS,
  write = writeAtomic,
}: HookStatusStoreOptions): HookStatusStore => {
  const events = new Map<string, EventRuntime>();
  const pid = process.pid;
  let updatedAt = now();
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writeFailureWarned = false;

  const snapshot = (): HookStatusSnapshot => {
    const hooks: Record<string, HookRuntimeEntry> = {};
    for (const [event, runtime] of events) {
      hooks[event] = copyRuntime(runtime);
    }
    return {
      version: 1,
      pid,
      workspace,
      updatedAt,
      hooks,
    };
  };

  const writeSnapshot = (): void => {
    dirty = false;
    try {
      write(file, JSON.stringify(snapshot()));
    } catch (error) {
      if (!writeFailureWarned) {
        writeFailureWarned = true;
        console.warn(
          `[owflow] hooks: failed to write runtime status file ${file}: ${errorMessage(error)}`,
        );
      }
    }
  };

  const flushNow = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    writeSnapshot();
  };

  const scheduleFlush = (): void => {
    dirty = true;
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (dirty) writeSnapshot();
    }, flushMs);
  };

  const runtimeFor = (event: string, startedAt = now()): EventRuntime => {
    const existing = events.get(event);
    if (existing !== undefined) return existing;
    const created: EventRuntime = {
      status: "pending",
      startedAt,
      active: new Set(),
      starts: new Map(),
    };
    events.set(event, created);
    return created;
  };

  const rememberSettled = (runtime: EventRuntime): void => {
    runtime.lastSettled = copyRuntime(runtime);
  };

  /**
   * A silent catch-all `event` run leaves no visible trace: once its pending
   * state is cleared, the row shows the outcome that preceded it, or goes idle
   * when the event has never settled in this snapshot.
   */
  const restoreLastSettled = (
    event: string,
    runtime: EventRuntime,
  ): void => {
    const previous = runtime.lastSettled;
    if (previous === undefined) {
      events.delete(event);
      return;
    }
    runtime.status = previous.status;
    runtime.startedAt = previous.startedAt;
    if (previous.finishedAt === undefined) delete runtime.finishedAt;
    else runtime.finishedAt = previous.finishedAt;
    if (previous.durationMs === undefined) delete runtime.durationMs;
    else runtime.durationMs = previous.durationMs;
    if (previous.reason === undefined) delete runtime.reason;
    else runtime.reason = previous.reason;
  };

  const clearRun = (
    runtime: EventRuntime,
    runId: string | undefined,
  ): void => {
    if (runId !== undefined) {
      runtime.active.delete(runId);
      runtime.starts.delete(runId);
      return;
    }
    const [firstRun] = runtime.active;
    if (firstRun !== undefined) {
      runtime.active.delete(firstRun);
      runtime.starts.delete(firstRun);
    }
  };

  const observe = (report: HookStatusReport): void => {
    const event = report.entry.event;
    const timestamp = now();

    if (report.phase === "skipped") {
      const runtime = runtimeFor(event);
      runtime.active.clear();
      runtime.starts.clear();
      runtime.status = "failure";
      runtime.startedAt = timestamp;
      runtime.finishedAt = timestamp;
      runtime.durationMs = 0;
      runtime.reason = report.reason ?? "hook cannot run";
      rememberSettled(runtime);
      updatedAt = timestamp;
      scheduleFlush();
      return;
    }

    if (report.phase === "pending") {
      const runId = report.runId ?? `${event}#anonymous`;
      const existing = events.get(event);
      if (existing !== undefined && existing.status !== "pending") {
        rememberSettled(existing);
      }
      const runtime = runtimeFor(event);
      runtime.active.add(runId);
      runtime.starts.set(runId, timestamp);
      runtime.status = "pending";
      runtime.startedAt = earliestStart(runtime);
      delete runtime.finishedAt;
      delete runtime.durationMs;
      delete runtime.reason;
      updatedAt = timestamp;
      scheduleFlush();
      return;
    }

    const runId = report.runId;
    // A settled report can arrive without a prior pending (a late capture from
    // an earlier fire); it carries the real start time and replaces the
    // previous fire's bookkeeping.
    const runtime = runtimeFor(event, report.startedAt ?? timestamp);
    if (runtime.active.size === 0) {
      runtime.startedAt = report.startedAt ?? runtime.startedAt;
    }

    clearRun(runtime, runId);

    if (report.noop === true) {
      if (runtime.active.size > 0) {
        runtime.status = "pending";
      } else {
        restoreLastSettled(event, runtime);
      }
      updatedAt = timestamp;
      scheduleFlush();
      return;
    }

    const outcome = report.outcome;
    const success = outcome?.status === "ok";
    const reason = report.reason ?? outcome?.reason;
    const terminal: HookRuntimeEntry = {
      status: success ? "success" : "failure",
      startedAt: runtime.startedAt,
      finishedAt: timestamp,
      durationMs: Math.max(0, timestamp - runtime.startedAt),
      ...(success || reason === undefined ? {} : { reason }),
    };
    // A real outcome stays the row's result even when a sibling run of the
    // same event is still pending, or when a later silent run clears itself.
    runtime.lastSettled = terminal;

    if (runtime.active.size > 0) {
      runtime.status = "pending";
      updatedAt = timestamp;
      scheduleFlush();
      return;
    }

    runtime.status = terminal.status;
    runtime.startedAt = terminal.startedAt;
    runtime.finishedAt = terminal.finishedAt;
    runtime.durationMs = terminal.durationMs;
    if (terminal.reason === undefined) delete runtime.reason;
    else runtime.reason = terminal.reason;
    updatedAt = timestamp;
    scheduleFlush();
  };

  // Clear stale statuses from a previous OpenCode run before the first hook
  // fires. This initial write is intentionally immediate.
  writeSnapshot();

  return {
    observe,
    snapshot,
    flushNow,
    dispose: flushNow,
  };
};
