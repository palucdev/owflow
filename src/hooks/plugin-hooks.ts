import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Hooks } from "@opencode-ai/plugin";
import { hooksDirectory, hooksLocationLabel } from "../utils/workflow-paths.js";

/* ── Events & Types ───────────────────────────────────────────────────────── */

export enum HookEvent {
  ToolExecuteBefore = "tool.execute.before",
  ToolExecuteAfter = "tool.execute.after",
  ToolDefinition = "tool.definition",
  ChatMessage = "chat.message",
  ChatParams = "chat.params",
  ChatHeaders = "chat.headers",
  CommandExecuteBefore = "command.execute.before",
  ShellEnv = "shell.env",
  ExperimentalChatMessagesTransform = "experimental.chat.messages.transform",
  ExperimentalChatSystemTransform = "experimental.chat.system.transform",
  ExperimentalSessionCompacting = "experimental.session.compacting",
  ExperimentalCompactionAutocontinue = "experimental.compaction.autocontinue",
  ExperimentalTextComplete = "experimental.text.complete",
  Config = "config",
  Event = "event",
  Dispose = "dispose",
}

export type DispatchableEvent = `${HookEvent}`;

export const DISPATCHABLE_EVENTS: readonly DispatchableEvent[] =
  Object.values(HookEvent);

export const HOST_EVENT_NAMES = [
  "command.executed", "file.edited", "file.watcher.updated",
  "installation.update-available", "installation.updated",
  "lsp.client.diagnostics", "lsp.updated",
  "message.part.removed", "message.part.updated",
  "message.removed", "message.updated",
  "permission.replied", "permission.updated",
  "pty.created", "pty.deleted", "pty.exited", "pty.updated",
  "server.connected", "server.instance.disposed",
  "session.compacted", "session.created", "session.deleted",
  "session.diff", "session.error", "session.idle", "session.status",
  "session.updated", "todo.updated",
  "tui.command.execute", "tui.prompt.append", "tui.toast.show",
  "vcs.branch.updated",
] as const;

export type HostEventName = (typeof HOST_EVENT_NAMES)[number];
export type HookEventName = DispatchableEvent | HostEventName;

export const HOOK_EVENT_NAMES: readonly HookEventName[] = [
  ...DISPATCHABLE_EVENTS,
  ...HOST_EVENT_NAMES,
];

export const EXCLUDED_EVENT_NAMES = [
  "permission.ask",
  "tool",
  "auth",
  "provider",
  "experimental.provider.small_model",
] as const;

export const isHostEventName = (value: string): value is HostEventName =>
  (HOST_EVENT_NAMES as readonly string[]).includes(value);

export const isHookEventName = (value: string): value is HookEventName =>
  (HOOK_EVENT_NAMES as readonly string[]).includes(value);

export enum HookDigestMode {
  FailFast = "fail-fast",
  Report = "report",
}

export interface InterpreterResolution {
  readonly resolved?: string;
  readonly expected: string;
  readonly available: boolean;
}

export interface HookRegistryEntry {
  readonly path: string;
  readonly event: HookEventName;
  readonly interpreter: InterpreterResolution;
  readonly status: "registered" | "will-fail-closed";
}

export interface HookValidationFailure {
  readonly path: string;
  readonly error: string;
}

export interface HookScan {
  readonly entries: readonly HookRegistryEntry[];
  readonly failures: readonly HookValidationFailure[];
}

export type HookRunState = "pending" | "success" | "failure";

export interface HookRuntimeEntry {
  readonly status: HookRunState;
  readonly startedAt: number;
  readonly finishedAt?: number;
  readonly durationMs?: number;
  readonly reason?: string;
}

export interface HookStatusSnapshot {
  readonly version: 1;
  readonly pid: number;
  readonly workspace: string;
  readonly updatedAt: number;
  readonly hooks: Readonly<Record<string, HookRuntimeEntry>>;
}

export type HookStatusReadResult =
  | { readonly kind: "missing" | "invalid" }
  | { readonly kind: "ok"; readonly snapshot: HookStatusSnapshot };

export interface HookRunLogRecord {
  readonly version: 1;
  readonly runId: string;
  readonly pid: number;
  readonly workspace: string;
  readonly event: HookEventName;
  readonly hook: string;
  readonly name: string;
  readonly sessionID?: string;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly durationMs: number;
  readonly status: "success" | "failure";
  readonly exitCode?: number | null;
  readonly signal?: string | null;
  readonly reason?: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly truncated?: boolean;
}

export type HookLogReadResult =
  | { readonly kind: "missing" | "invalid" }
  | { readonly kind: "ok"; readonly records: readonly HookRunLogRecord[]; readonly truncated: boolean };

export type Dispatcher = (
  event: HookEventName,
  input?: unknown,
  output?: Record<string, unknown>,
) => Promise<void>;

export type HookReportRow = Readonly<
  Record<"path" | "event" | "interpreter" | "status", string>
>;

export interface HookReportInput {
  readonly entries: readonly HookRegistryEntry[];
  readonly failures?: readonly HookValidationFailure[];
  readonly bypassed?: boolean;
}

/* ── Discovery & Scan ─────────────────────────────────────────────────────── */

const HOOK_STEM_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RECOVERY_HINT =
  "Hint: fix or remove the invalid file(s) and restart OpenCode. The owflow plugin — including the destructive-command guard — has been dropped until the hooks directory validates. To start without user hooks, set OWFLOW_HOOKS_DISABLED=1.";

export const interpreterLabel = (i: InterpreterResolution): string =>
  `${i.resolved ?? i.expected} (${i.available ? "available" : "missing"})`;

export const scanHooks = (
  hooksDir: string,
  options: { mode?: HookDigestMode; which?: (cmd: string) => string | null } = {},
): HookScan => {
  const mode = options.mode ?? HookDigestMode.FailFast;
  const which = options.which ?? Bun.which;
  if (!fs.existsSync(hooksDir)) return { entries: [], failures: [] };
  if (!fs.statSync(hooksDir).isDirectory()) {
    const failures = [
      { path: hooksDir, error: `the hooks anchor exists but is not a directory (${hooksLocationLabel})` },
    ];
    if (mode === HookDigestMode.FailFast) throw new Error(formatFatal(failures));
    return { entries: [], failures };
  }

  const sh = which("bash") ?? undefined;
  const ps1 = which("pwsh") ?? which("powershell.exe") ?? undefined;
  const interpreters: Record<".sh" | ".ps1", InterpreterResolution> = {
    ".sh": { expected: "bash", available: Boolean(sh), ...(sh ? { resolved: sh } : {}) },
    ".ps1": { expected: "pwsh", available: Boolean(ps1), ...(ps1 ? { resolved: ps1 } : {}) },
  };

  const raw: Array<{ stem: string; entry: HookRegistryEntry }> = [];
  const failures: HookValidationFailure[] = [];

  for (const dirent of fs.readdirSync(hooksDir, { withFileTypes: true })) {
    const entryPath = path.join(hooksDir, dirent.name);
    if (!dirent.isFile()) {
      failures.push({ path: entryPath, error: `not a regular file (only hook scripts belong in ${hooksLocationLabel}/)` });
      continue;
    }
    const ext = path.extname(dirent.name);
    if (ext !== ".sh" && ext !== ".ps1") {
      failures.push({ path: entryPath, error: `extension "${ext || "(none)"}" is not routable (expected .sh or .ps1)` });
      continue;
    }
    const stem = dirent.name.slice(0, -ext.length);
    if (!HOOK_STEM_PATTERN.test(stem)) {
      failures.push({ path: entryPath, error: `stem "${stem}" is not lowercase kebab-case ([a-z0-9]+(-[a-z0-9]+)*)` });
      continue;
    }
    const event = stem.replaceAll("-", ".");
    if ((EXCLUDED_EVENT_NAMES as readonly string[]).includes(event)) {
      failures.push({ path: entryPath, error: `stem "${stem}" derives to "${event}", an excluded event that cannot be hooked` });
      continue;
    }
    if (!isHookEventName(event)) {
      failures.push({ path: entryPath, error: `stem "${stem}" derives to "${event}", which is not a dispatchable hook or a known host event` });
      continue;
    }
    const interpreter = interpreters[ext];
    raw.push({
      stem,
      entry: {
        path: entryPath,
        event,
        interpreter,
        status: interpreter.available ? "registered" : "will-fail-closed",
      },
    });
  }

  const byStem = Map.groupBy(raw, (item) => item.stem);
  const entries: HookRegistryEntry[] = [];
  for (const [stem, group] of byStem) {
    if (group.length === 1) {
      entries.push(group[0]!.entry);
      continue;
    }
    const names = group.map((g) => path.basename(g.entry.path)).join(", ");
    for (const g of group) {
      failures.push({
        path: g.entry.path,
        error: `hook name "${stem}" is provided by multiple files (${names}); define it in exactly one format`,
      });
    }
  }

  entries.sort((a, b) => (a.event < b.event ? -1 : a.event > b.event ? 1 : 0));
  failures.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (mode === HookDigestMode.FailFast && failures.length > 0) {
    throw new Error(formatFatal(failures));
  }
  return { entries, failures };
};

const formatFatal = (failures: readonly HookValidationFailure[]): string => {
  const count = failures.length === 1 ? "1 invalid entry" : `${failures.length} invalid entries`;
  const rows = failures.map((f) => `  - ${f.path}: ${f.error}`).join("\n");
  return `[owflow] ${count} in ${hooksLocationLabel}/\n${rows}\n${RECOVERY_HINT}`;
};

/* ── Reporting ────────────────────────────────────────────────────────────── */

export const EFFECTIVE_AFTER_RESTART = "effective after next restart";
export const TABLE_COLUMNS = ["path", "event", "interpreter", "status"] as const;

export const buildReportRows = (input: HookReportInput): readonly HookReportRow[] => [
  ...(input.bypassed
    ? [{ path: "(all hooks)", event: "-", interpreter: "-", status: "hooks bypassed (OWFLOW_HOOKS_DISABLED=1)" }]
    : []),
  ...input.entries.map((e) => ({
    path: e.path,
    event: e.event,
    interpreter: interpreterLabel(e.interpreter),
    status: e.status === "registered" ? "registered" : "will fail closed at fire",
  })),
  ...(input.failures ?? []).map((f) => ({
    path: f.path,
    event: "-",
    interpreter: "-",
    status: `invalid: ${f.error}`,
  })),
];

export const renderTable = (input: HookReportInput): string => {
  const grid = [
    [...TABLE_COLUMNS],
    ...buildReportRows(input).map((r) => [r.path, r.event, r.interpreter, r.status]),
  ];
  const widths = TABLE_COLUMNS.map((_, i) => Math.max(...grid.map((row) => row[i]!.length)));
  const lines = grid.map((row) => row.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd());
  return [...lines, "", EFFECTIVE_AFTER_RESTART].join("\n");
};

export const renderSnapshot = (input: HookReportInput): readonly string[] => {
  const invalid = input.failures?.length ?? 0;
  const head = `[owflow] hooks: ${input.entries.length} loaded${invalid > 0 ? `, ${invalid} invalid` : ""}`;
  return [
    head,
    ...buildReportRows(input).map((r) => `[owflow]   ${r.path} -> ${r.event} ${r.interpreter} - ${r.status}`),
  ];
};

export const renderJson = (input: HookReportInput): string =>
  JSON.stringify(
    { label: EFFECTIVE_AFTER_RESTART, bypassed: input.bypassed === true, rows: buildReportRows(input) },
    null,
    2,
  );

/* ── Status & Log Persistence ─────────────────────────────────────────────── */

export const STATUS_FILE_ENV = "OWFLOW_HOOKS_STATUS_FILE";
export const LOG_FILE_ENV = "OWFLOW_HOOK_LOGS_FILE";
export const HOOK_TIMEOUT_ENV = "OWFLOW_HOOK_TIMEOUT_MS";
export const MAX_CAPTURE_BYTES = 16 * 1024;
export const MAX_LOG_FILE_BYTES = 4 * 1024 * 1024;

const workspaceKey = (workspace: string): string => {
  let resolved = path.resolve(workspace);
  try {
    resolved = fs.realpathSync.native(resolved);
  } catch {
    // keep resolved path when workspace does not exist yet
  }
  return crypto
    .createHash("sha256")
    .update(process.platform === "win32" ? resolved.toLowerCase() : resolved)
    .digest("hex")
    .slice(0, 16);
};

export const resolveHooksStatusFile = (workspace: string): string =>
  process.env[STATUS_FILE_ENV] ??
  path.join(os.tmpdir(), "opencode", `owflow-hooks-${workspaceKey(workspace)}.json`);

export const resolveHooksLogFile = (workspace: string): string =>
  process.env[LOG_FILE_ENV] ??
  path.join(os.tmpdir(), "opencode", `owflow-hook-logs-${workspaceKey(workspace)}.jsonl`);

// shortcut: synchronous writeFileSync per hook state transition without trailing debounce or .tmp rename;
// ceiling: >100 hook fires/sec causing tmp file contention or partial reads;
// upgrade: 50ms trailing debounce with write-to-tmp-and-rename.
const writeStatusFile = (
  file: string,
  workspace: string,
  hooks: ReadonlyMap<string, HookRuntimeEntry>,
): void => {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) return;
    const snapshot: HookStatusSnapshot = {
      version: 1,
      pid: process.pid,
      workspace,
      updatedAt: Date.now(),
      hooks: Object.fromEntries(hooks),
    };
    fs.writeFileSync(file, JSON.stringify(snapshot), { encoding: "utf8", mode: 0o600 });
  } catch {
    // Best-effort status persistence never affects hook execution.
  }
};

export const readHookStatusSnapshot = (file: string): HookStatusReadResult => {
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) return { kind: "invalid" };
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (parsed?.version !== 1 || typeof parsed.hooks !== "object" || parsed.hooks === null) {
      return { kind: "invalid" };
    }
    return { kind: "ok", snapshot: parsed as HookStatusSnapshot };
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === "ENOENT"
      ? { kind: "missing" }
      : { kind: "invalid" };
  }
};

// shortcut: reads full JSONL file via readFileSync instead of a 512KB fd tail-seek and relies on 16KB stream caps;
// ceiling: log files >4MB rotation cap;
// upgrade: fs.openSync tail-slice reader.
export const readHookLogRecords = (file: string): HookLogReadResult => {
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) return { kind: "invalid" };
    const raw = fs.readFileSync(file, "utf8");
    const records: HookRunLogRecord[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        if (rec?.version === 1 && typeof rec.event === "string" && typeof rec.name === "string") {
          records.push(rec as HookRunLogRecord);
        }
      } catch {
        // skip malformed lines
      }
    }
    return { kind: "ok", records, truncated: false };
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === "ENOENT"
      ? { kind: "missing" }
      : { kind: "invalid" };
  }
};

export const readLatestHookLog = (
  file: string,
  event: HookEventName,
  since = Number.NEGATIVE_INFINITY,
): HookRunLogRecord | undefined => {
  const result = readHookLogRecords(file);
  if (result.kind !== "ok") return undefined;
  return result.records.findLast((r) => r.event === event && r.startedAt >= since);
};

/* ── Git-Hooks Style Execution & Dispatch ─────────────────────────────────── */

const IDENTITY_KEYS = ["id", "sessionID", "messageID", "partID", "callID", "providerID", "type", "name", "tool"];

// shortcut: JSON.stringify replacer strips class-instance internals to id/name/type/sessionID instead of a recursive AST projector;
// ceiling: host objects with throwing getters or deep circular refs;
// upgrade: explicit per-event context projection.
export const buildStdinPayload = (
  event: HookEventName,
  input: unknown,
  output: unknown,
  sessionID?: string,
): string => {
  const context: Record<string, unknown> = {};
  for (const src of [input, output]) {
    if (typeof src === "object" && src !== null && !Array.isArray(src)) {
      Object.assign(context, src);
    }
  }
  return JSON.stringify(
    {
      event,
      ...(sessionID ? { session: { sessionID } } : {}),
      context,
    },
    (_key, value) => {
      if (typeof value === "bigint") return value.toString();
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        const proto = Object.getPrototypeOf(value);
        if (proto !== Object.prototype && proto !== null) {
          const picked: Record<string, unknown> = {};
          for (const k of IDENTITY_KEYS) {
            if (value[k] !== undefined) picked[k] = value[k];
          }
          return picked;
        }
      }
      return value;
    },
  );
};

const sessionIDFrom = (input: unknown): string | undefined => {
  const rec = input as Record<string, any> | undefined;
  const candidate =
    rec?.sessionID ??
    rec?.event?.properties?.sessionID ??
    rec?.event?.properties?.part?.sessionID ??
    rec?.event?.properties?.info?.sessionID;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
};

const capStream = (text: string): { text: string; truncated: boolean } => {
  if (Buffer.byteLength(text, "utf8") <= MAX_CAPTURE_BYTES) {
    return { text, truncated: false };
  }
  return {
    text: Buffer.from(text, "utf8").subarray(0, MAX_CAPTURE_BYTES).toString("utf8"),
    truncated: true,
  };
};

export interface HooksWrapper {
  readonly dispatch: Dispatcher;
  readonly snapshot: HookReportInput;
  dispose(): void;
}

export interface HooksWrapperOptions {
  readonly statusFile?: string;
  readonly logFile?: string;
}

export const initializeHooksWrapper = async (
  directory: string,
  endSession?: (sessionID: string) => Promise<void> | void,
  options: HooksWrapperOptions = {},
): Promise<HooksWrapper> => {
  const { entries } = scanHooks(hooksDirectory(directory));
  const byEvent = Map.groupBy(entries, (e) => e.event);
  const statusFile = options.statusFile ?? resolveHooksStatusFile(directory);
  const logFile = options.logFile ?? resolveHooksLogFile(directory);
  const statuses = new Map<string, HookRuntimeEntry>();
  const activeProcs = new Set< ReturnType<typeof Bun.spawn> >();
  let runCounter = 0;
  let lastLogKey: string | undefined;

  writeStatusFile(statusFile, directory, statuses);

  const appendLog = (record: HookRunLogRecord): void => {
    try {
      const key = JSON.stringify([
        record.event, record.hook, record.sessionID, record.status,
        record.reason, record.exitCode, record.signal, record.stdout, record.stderr,
      ]);
      if (key === lastLogKey) return;
      fs.mkdirSync(path.dirname(logFile), { recursive: true, mode: 0o700 });
      if (fs.existsSync(logFile)) {
        const stat = fs.lstatSync(logFile);
        if (stat.isSymbolicLink()) return;
        if (stat.size > MAX_LOG_FILE_BYTES) fs.renameSync(logFile, `${logFile}.1`);
      }
      fs.appendFileSync(logFile, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
      lastLogKey = key;
    } catch {
      // Best-effort log persistence never affects hook execution.
    }
  };

  const abortSession = async (sessionID: string | undefined, scriptPath: string): Promise<void> => {
    if (!endSession || !sessionID) return;
    try {
      await endSession(sessionID);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[owflow] hooks: failed to end session ${sessionID} after ${scriptPath} failed: ${msg}`);
    }
  };

  const dispatch: Dispatcher = async (event, input, output) => {
    const hooks = byEvent.get(event);
    if (!hooks || hooks.length === 0) return;

    const sessionID = sessionIDFrom(input);
    const stdinText = buildStdinPayload(event, input, output, sessionID);

    for (const entry of hooks) {
      runCounter += 1;
      const runId = `${event}#${runCounter}`;
      const startedAt = Date.now();
      const name = path.basename(entry.path, path.extname(entry.path));

      if (!entry.interpreter.available || !entry.interpreter.resolved) {
        const label = entry.interpreter.resolved ?? entry.interpreter.expected;
        const reason = `${label} is not available`;
        statuses.set(event, { status: "failure", startedAt, finishedAt: startedAt, durationMs: 0, reason });
        writeStatusFile(statusFile, directory, statuses);
        appendLog({
          version: 1, runId, pid: process.pid, workspace: directory,
          event, hook: entry.path, name, ...(sessionID ? { sessionID } : {}),
          startedAt, finishedAt: startedAt, durationMs: 0, status: "failure", reason,
        });
        await abortSession(sessionID, entry.path);
        throw new Error(
          `Blocked: hook ${entry.path} cannot run: the ${label} interpreter is not available. ` +
            `Hint: install ${label} and restart OpenCode, or remove the script to stop failing closed.`,
        );
      }

      const previousStatus = statuses.get(event);
      statuses.set(event, { status: "pending", startedAt });
      writeStatusFile(statusFile, directory, statuses);

      // shortcut: buffers full child stdout/stderr via Response.text() before slicing to 16KB;
      // ceiling: runaway hook writing >100MB to stdio;
      // upgrade: ReadableStream.getReader() loop with byte counter and cancel().
      const proc = Bun.spawn([entry.interpreter.resolved, entry.path], {
        cwd: directory,
        stdin: Buffer.from(stdinText),
        stdout: "pipe",
        stderr: "pipe",
      });
      activeProcs.add(proc);

      const timeoutMs = Number(process.env[HOOK_TIMEOUT_ENV]);
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const ioPromise = Promise.all([
        new Response(proc.stdout).text().catch(() => ""),
        new Response(proc.stderr).text().catch(() => ""),
        proc.exited,
      ]);

      let rawStdout = "";
      let rawStderr = "";
      let exitCode: number | null = null;
      try {
        const res =
          Number.isFinite(timeoutMs) && timeoutMs > 0
            ? await Promise.race([
                ioPromise,
                new Promise<"timeout">((resolve) => {
                  timer = setTimeout(() => {
                    timedOut = true;
                    try { proc.kill(); } catch {}
                    resolve("timeout");
                  }, Math.floor(timeoutMs));
                  timer.unref?.();
                }),
              ])
            : await ioPromise;
        if (res !== "timeout") [rawStdout, rawStderr, exitCode] = res;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        activeProcs.delete(proc);
      }

      const finishedAt = Date.now();
      const durationMs = Math.max(0, finishedAt - startedAt);
      const out = capStream(rawStdout);
      const err = capStream(rawStderr);
      const truncated = out.truncated || err.truncated;
      const signal = proc.signalCode ?? null;
      const ok = !timedOut && exitCode === 0 && signal === null;

      // Silent successful catch-all `event` runs leave no status/log trace so hot bus events don't flood.
      if (ok && event === HookEvent.Event && !out.text.trim() && !err.text.trim()) {
        if (previousStatus) statuses.set(event, previousStatus);
        else statuses.delete(event);
        writeStatusFile(statusFile, directory, statuses);
        continue;
      }

      const reason = ok
        ? undefined
        : timedOut
          ? `process timed out after ${Math.floor(timeoutMs)}ms`
          : err.text.trim() || out.text.trim() || (signal ? `process terminated by signal ${signal}` : `process exited with code ${exitCode}`);

      statuses.set(event, {
        status: ok ? "success" : "failure",
        startedAt,
        finishedAt,
        durationMs,
        ...(reason ? { reason } : {}),
      });
      writeStatusFile(statusFile, directory, statuses);

      appendLog({
        version: 1,
        runId,
        pid: process.pid,
        workspace: directory,
        event,
        hook: entry.path,
        name,
        ...(sessionID ? { sessionID } : {}),
        startedAt,
        finishedAt,
        durationMs,
        status: ok ? "success" : "failure",
        exitCode,
        ...(signal ? { signal } : {}),
        ...(reason ? { reason } : {}),
        ...(out.text ? { stdout: out.text } : {}),
        ...(err.text ? { stderr: err.text } : {}),
        ...(truncated ? { truncated: true } : {}),
      });

      if (!ok) {
        await abortSession(sessionID, entry.path);
        const body = reason?.startsWith("Blocked:") ? reason : `Blocked: ${reason || `hook ${entry.path} failed`}`;
        throw new Error(
          `${body.endsWith(".") ? body : `${body}.`} Hint: fix the failing script ${entry.path} (failure ends the current session; fail closed), or remove it and restart OpenCode to proceed.`,
        );
      }
    }
  };

  return {
    dispatch,
    snapshot: { entries },
    dispose: () => {
      for (const proc of activeProcs) {
        try { proc.kill(); } catch {}
      }
      activeProcs.clear();
    },
  };
};

export const PASSTHROUGH_EVENTS = [
  HookEvent.ToolExecuteAfter,
  HookEvent.ToolDefinition,
  HookEvent.ChatParams,
  HookEvent.ChatHeaders,
  HookEvent.CommandExecuteBefore,
  HookEvent.ShellEnv,
  HookEvent.ExperimentalChatMessagesTransform,
  HookEvent.ExperimentalChatSystemTransform,
  HookEvent.ExperimentalCompactionAutocontinue,
  HookEvent.ExperimentalTextComplete,
  HookEvent.Dispose,
] as const satisfies readonly DispatchableEvent[];

export const createDispatchHandlers = (dispatch: Dispatcher): Hooks => {
  const handlers = Object.fromEntries(
    PASSTHROUGH_EVENTS.map((event) => [
      event,
      (input?: unknown, output?: Record<string, unknown>) => dispatch(event, input, output),
    ]),
  ) as Hooks;

  const chains = new Map<string, Promise<void>>();
  const runSerialized = (key: string, task: () => Promise<void>): Promise<void> => {
    const next = (chains.get(key) ?? Promise.resolve()).catch(() => {}).then(task);
    const tracked = next.finally(() => {
      if (chains.get(key) === tracked) chains.delete(key);
    });
    tracked.catch(() => {});
    chains.set(key, tracked);
    return next;
  };

  return {
    ...handlers,
    [HookEvent.Event]: async (input: unknown) => {
      const type = (input as { event?: { type?: unknown } } | undefined)?.event?.type;
      if (typeof type === "string" && isHostEventName(type)) {
        await runSerialized(type, () => dispatch(type, input));
      }
      await runSerialized(HookEvent.Event, () => dispatch(HookEvent.Event, input));
    },
  };
};
