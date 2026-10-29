/** Shared model for the user-hooks subsystem. Host-framework free. */

/* ── Events ───────────────────────────────────────────────────────────────── */

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
export type HookExtension = ".sh" | ".ps1";
export type HookEntryStatus = "registered" | "will-fail-closed";

/** All dispatchable events; fail-closed gate semantics apply to every hook. */
export const DISPATCHABLE_EVENTS: readonly DispatchableEvent[] = [
  HookEvent.ToolExecuteBefore,
  HookEvent.ToolExecuteAfter,
  HookEvent.ToolDefinition,
  HookEvent.ChatMessage,
  HookEvent.ChatParams,
  HookEvent.ChatHeaders,
  HookEvent.CommandExecuteBefore,
  HookEvent.ShellEnv,
  HookEvent.ExperimentalChatMessagesTransform,
  HookEvent.ExperimentalChatSystemTransform,
  HookEvent.ExperimentalSessionCompacting,
  HookEvent.ExperimentalCompactionAutocontinue,
  HookEvent.ExperimentalTextComplete,
  HookEvent.Config,
  HookEvent.Event,
  HookEvent.Dispose,
];

export const DISPATCHABLE_EVENT_NAMES: readonly DispatchableEvent[] =
  DISPATCHABLE_EVENTS;

/** Host bus events; observe-only because the bus has no writable output. */
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

export const isHostEventName = (value: string): value is HostEventName =>
  (HOST_EVENT_NAMES as readonly string[]).includes(value);

export const isHookEventName = (value: string): value is HookEventName =>
  (DISPATCHABLE_EVENTS as readonly string[]).includes(value) ||
  isHostEventName(value);

export const HOOK_EVENT_NAMES: readonly HookEventName[] = [
  ...DISPATCHABLE_EVENT_NAMES,
  ...HOST_EVENT_NAMES,
];

export const EXCLUDED_EVENT_NAMES: readonly string[] = [
  "permission.ask",
  "tool",
  "auth",
  "provider",
  "experimental.provider.small_model",
];

export type HookDerivation =
  | Readonly<{ kind: "dispatchable"; event: DispatchableEvent }>
  | Readonly<{ kind: "host-event"; event: HostEventName }>
  | Readonly<{ kind: "excluded" }>
  | Readonly<{ kind: "unknown"; event: string }>;

/* ── Discovery and registration ───────────────────────────────────────────── */

export type InterpreterResolution = Readonly<{
  resolved?: string;
  expected?: string;
  available: boolean;
}>;
export type InterpreterAvailability = Readonly<
  Record<HookExtension, InterpreterResolution>
>;

type HookBase = Readonly<{
  path: string;
  event: HookEventName;
}>;
export type HookScript = HookBase & Readonly<{
  stem: string;
  extension: HookExtension;
}>;
/** A script after interpreter resolution; discovery-only fields are dropped. */
export type HookRegistryEntry = HookBase & Readonly<{
  interpreter: InterpreterResolution;
  status: HookEntryStatus;
}>;

export type HookValidationFailure = Readonly<{ path: string; error: string }>;

export enum HookDigestMode {
  FailFast = "fail-fast",
  Report = "report",
}

export type HookDigest = Readonly<{
  entries: readonly HookScript[];
  failures: readonly HookValidationFailure[];
}>;
export type HookRegistry = Readonly<{
  entries: readonly HookRegistryEntry[];
  byEvent: Readonly<Record<HookEventName, readonly HookRegistryEntry[]>>;
}>;
export type WhichInterpreter = (command: string) => string | null;
export type HookScanOptions = Readonly<{
  mode?: HookDigestMode;
  which?: WhichInterpreter;
}>;
export type HookScan = Readonly<{
  registry: HookRegistry;
  failures: HookDigest["failures"];
}>;

/* ── Outcomes and envelope ────────────────────────────────────────────────── */

export type OutcomeStatus = "ok" | "blocked" | "failed";

export type HookCapture = Readonly<{
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  signal?: string | null;
  truncated?: boolean;
}>;

type OutcomePayload = Readonly<{
  status: OutcomeStatus;
  reason?: string;
  mutations?: Record<string, unknown>;
}>;
export type Outcome = OutcomePayload & Readonly<{ capture?: HookCapture }>;

export type EnvelopeContext = Readonly<{
  protocol: "owflow-hooks/1";
  event: HookEventName;
  class: "gate";
  session?: Readonly<{ sessionID: string }>;
  context: Record<string, unknown>;
}>;
export type EnvelopeResult = OutcomePayload &
  Readonly<{ protocol: "owflow-hooks/1" }>;
export type EnvelopeBuildInput = Readonly<{
  event: HookEventName;
  context: Record<string, unknown>;
  sessionID?: string;
}>;
export type ParsedEnvelopeResult = Readonly<{
  ok: boolean;
  data?: EnvelopeResult;
  error?: string;
}>;

/* ── Runners ──────────────────────────────────────────────────────────────── */

export type HookRunner = Readonly<{
  run: (
    entry: HookRegistryEntry,
    envelope: EnvelopeContext,
  ) => Promise<Outcome>;
  dispose?: () => void;
}>;

export type SpawnProcessOptions = Readonly<{
  cwd: string;
  stdin: Uint8Array;
  stdout: "pipe";
  stderr: "pipe";
}>;
export type StreamReader = Readonly<{
  read(): Promise<Readonly<{ done: boolean; value?: Uint8Array }>>;
  cancel?(): Promise<void> | void;
}>;
export type SpawnedStream = Readonly<{
  text(): Promise<string>;
  getReader?(): StreamReader;
}>;
export type SpawnedProcess = Readonly<{
  exited: Promise<number | null>;
  exitCode?: number | null;
  signalCode?: string | null;
  stdout?: SpawnedStream | null;
  stderr?: SpawnedStream | null;
  kill?: (signal?: number | NodeJS.Signals) => void;
}>;
export type SpawnProcess = (
  command: string[],
  options: SpawnProcessOptions,
) => SpawnedProcess;
export type SubprocessRunnerDeps = Readonly<{
  cwd: string;
  spawn?: SpawnProcess;
  timeoutMs?: number;
}>;

/* ── Dispatch ─────────────────────────────────────────────────────────────── */

export type HookRunState = "pending" | "success" | "failure";
export type HookRuntimeEntry = Readonly<{
  status: HookRunState;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  reason?: string;
}>;
export type HookStatusSnapshot = Readonly<{
  version: 1;
  pid: number;
  workspace: string;
  updatedAt: number;
  hooks: Readonly<Record<string, HookRuntimeEntry>>;
}>;

type ReportBase = Readonly<{
  entry: HookRegistryEntry;
  outcome?: Outcome;
  reason?: string;
}>;
export type HookStatusReport = ReportBase & Readonly<{
  phase: "pending" | "settled" | "skipped";
  runId?: string;
  startedAt?: number;
  noop?: boolean;
}>;

type ReadResult<T> =
  | Readonly<{ kind: "missing" | "invalid" }>
  | (Readonly<{ kind: "ok" }> & T);
export type HookStatusReadResult = ReadResult<
  Readonly<{ snapshot: HookStatusSnapshot }>
>;
export type HookRunLogReport = ReportBase & Readonly<{
  runId: string;
  phase: "settled" | "skipped";
  sessionID?: string;
  startedAt: number;
  finishedAt: number;
  capture?: HookCapture;
}>;
export type HookRunLogRecord = HookCapture & Readonly<{
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
  outcome: OutcomeStatus;
  reason?: string;
}>;
export type HookLogReadResult = ReadResult<
  Readonly<{ records: readonly HookRunLogRecord[]; truncated: boolean }>
>;

export type DispatcherOptions = Readonly<{
  run: HookRunner["run"];
  registry: HookRegistry;
  endSession?: (sessionID: string) => Promise<void> | void;
  onStatus?: (report: HookStatusReport) => void;
  onRunLog?: (report: HookRunLogReport) => void;
  now?: () => number;
}>;
export type Dispatcher = (
  event: HookEventName,
  input?: unknown,
  output?: Record<string, unknown>,
) => Promise<void>;

/* ── Reporting ────────────────────────────────────────────────────────────── */

export type HookReportRow = Readonly<
  Record<"path" | "event" | "interpreter" | "status", string>
>;
export type HookReportInput = Readonly<{
  entries: readonly HookRegistryEntry[];
  failures?: readonly HookValidationFailure[];
  bypassed?: boolean;
}>;
