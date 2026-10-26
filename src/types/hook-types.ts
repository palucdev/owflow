/**
 * Shared model for the user-hooks subsystem.
 *
 * Every hook type, enum, and event table lives here so the platform-agnostic
 * wrapper core, the server adapter, the CLI, the TUI, and tests all speak the
 * same vocabulary. This module must stay free of host-framework imports.
 */

/* ── Events ───────────────────────────────────────────────────────────────── */

/** Canonical event names. Referenced everywhere instead of string literals. */
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

export type HookClass = "gate" | "observe";

export type HookExtension = ".sh" | ".ps1";

export type HookEntryStatus =
  | "registered"
  | "will-fail-closed"
  | "skipped-no-interpreter";

/** The one event table shared by every surface, so classes agree by construction. */
export const DISPATCHABLE_EVENTS: Readonly<
  Record<DispatchableEvent, HookClass>
> = {
  [HookEvent.ToolExecuteBefore]: "gate",
  [HookEvent.ToolExecuteAfter]: "gate",
  [HookEvent.ToolDefinition]: "gate",
  [HookEvent.ChatMessage]: "gate",
  [HookEvent.ChatParams]: "gate",
  [HookEvent.ChatHeaders]: "gate",
  [HookEvent.CommandExecuteBefore]: "gate",
  [HookEvent.ShellEnv]: "gate",
  [HookEvent.ExperimentalChatMessagesTransform]: "gate",
  [HookEvent.ExperimentalChatSystemTransform]: "gate",
  [HookEvent.ExperimentalSessionCompacting]: "gate",
  [HookEvent.ExperimentalCompactionAutocontinue]: "gate",
  [HookEvent.ExperimentalTextComplete]: "gate",
  [HookEvent.Config]: "observe",
  [HookEvent.Event]: "observe",
  [HookEvent.Dispose]: "observe",
};

export const DISPATCHABLE_EVENT_NAMES: readonly DispatchableEvent[] =
  Object.keys(DISPATCHABLE_EVENTS) as DispatchableEvent[];

/**
 * OpenCode v1 host events that may be used as hook names. All of them arrive
 * through the single `event` hook, so an event-named script fires only when the
 * host emits its matching `event.type`. They are observe-only: the host event
 * stream has no writable output.
 */
export const HOST_EVENT_NAMES = [
  "command.executed",
  "file.edited",
  "file.watcher.updated",
  "installation.update-available",
  "installation.updated",
  "lsp.client.diagnostics",
  "lsp.updated",
  "message.part.removed",
  "message.part.updated",
  "message.removed",
  "message.updated",
  "permission.replied",
  "permission.updated",
  "pty.created",
  "pty.deleted",
  "pty.exited",
  "pty.updated",
  "server.connected",
  "server.instance.disposed",
  "session.compacted",
  "session.created",
  "session.deleted",
  "session.diff",
  "session.error",
  "session.idle",
  "session.status",
  "session.updated",
  "todo.updated",
  "tui.command.execute",
  "tui.prompt.append",
  "tui.toast.show",
  "vcs.branch.updated",
] as const;

export type HostEventName = (typeof HOST_EVENT_NAMES)[number];

/** Every name a hook file may derive to: host hook events and host bus events. */
export type HookEventName = DispatchableEvent | HostEventName;

export const isHostEventName = (value: string): value is HostEventName =>
  (HOST_EVENT_NAMES as readonly string[]).includes(value);

export const isHookEventName = (value: string): value is HookEventName =>
  Object.hasOwn(DISPATCHABLE_EVENTS, value) || isHostEventName(value);

export const HOOK_EVENT_NAMES: readonly HookEventName[] = [
  ...DISPATCHABLE_EVENT_NAMES,
  ...HOST_EVENT_NAMES,
];

/** Host bus events are observe-only; hook events carry their table class. */
export const hookClassOf = (event: HookEventName): HookClass =>
  Object.hasOwn(DISPATCHABLE_EVENTS, event)
    ? DISPATCHABLE_EVENTS[event as DispatchableEvent]
    : "observe";

/** Names that must never derive to a dispatchable event. */
export const EXCLUDED_EVENT_NAMES: readonly string[] = [
  "permission.ask",
  "tool",
  "auth",
  "provider",
  "experimental.provider.small_model",
];

export type HookDerivation =
  | {
      readonly kind: "dispatchable";
      readonly event: DispatchableEvent;
      readonly class: HookClass;
    }
  | {
      readonly kind: "host-event";
      readonly event: HostEventName;
      readonly class: "observe";
    }
  | { readonly kind: "excluded" }
  | { readonly kind: "unknown"; readonly event: string };

/* ── Discovery and registration ───────────────────────────────────────────── */

export interface InterpreterResolution {
  readonly resolved?: string;
  readonly expected?: string;
  readonly available: boolean;
}

export type InterpreterAvailability = Readonly<
  Record<".sh" | ".ps1", InterpreterResolution>
>;

export interface HookScript {
  readonly path: string;
  readonly stem: string;
  readonly event: HookEventName;
  readonly class: HookClass;
  readonly extension: HookExtension;
}

export interface HookValidationFailure {
  readonly path: string;
  readonly error: string;
}

/** Descriptive scan modes: fail fast at startup, collect all rows for reports. */
export enum HookDigestMode {
  FailFast = "fail-fast",
  Report = "report",
}

export interface HookDigest {
  readonly entries: readonly HookScript[];
  readonly failures: readonly HookValidationFailure[];
}

export interface HookRegistryEntry {
  readonly path: string;
  readonly event: HookEventName;
  readonly class: HookClass;
  readonly interpreter: InterpreterResolution;
  readonly status: HookEntryStatus;
}

export interface HookRegistry {
  readonly entries: readonly HookRegistryEntry[];
  readonly byEvent: Readonly<
    Record<HookEventName, readonly HookRegistryEntry[]>
  >;
}

/** Injectable `Bun.which` seam; `null` means the executable is not on PATH. */
export type WhichInterpreter = (command: string) => string | null;

export interface HookScanOptions {
  readonly mode?: HookDigestMode;
  readonly which?: WhichInterpreter;
}

export interface HookScan {
  readonly registry: HookRegistry;
  readonly failures: readonly HookValidationFailure[];
}

/* ── Outcomes and envelope ────────────────────────────────────────────────── */

export type OutcomeStatus = "ok" | "blocked" | "failed";

/** Free-form output captured from one hook run; never contains the envelope. */
export interface HookCapture {
  /** Raw stdout only when it was malformed; valid envelopes are not duplicated. */
  readonly stdout?: string;
  /** Free-form diagnostics channel (stderr). */
  readonly stderr?: string;
  readonly exitCode?: number | null;
  readonly signal?: string | null;
  /** True when any captured stream hit its cap. */
  readonly truncated?: boolean;
}

export interface Outcome {
  readonly status: OutcomeStatus;
  readonly reason?: string;
  readonly mutations?: Record<string, unknown>;
  readonly capture?: HookCapture;
}

export interface EnvelopeContext {
  readonly protocol: "owflow-hooks/1";
  readonly event: HookEventName;
  readonly class: HookClass;
  readonly session?: { readonly sessionID: string };
  readonly context: Record<string, unknown>;
}

export interface EnvelopeResult {
  readonly protocol: "owflow-hooks/1";
  readonly status: OutcomeStatus;
  readonly reason?: string;
  readonly mutations?: Record<string, unknown>;
}

export interface EnvelopeBuildInput {
  readonly event: HookEventName;
  readonly context: Record<string, unknown>;
  readonly sessionID?: string | undefined;
}

export interface ParsedEnvelopeResult {
  ok: boolean;
  data?: EnvelopeResult;
  error?: string;
}

/* ── Runners ──────────────────────────────────────────────────────────────── */

/** One execution interface for every script — the v2 seam unit. */
export interface HookRunner {
  readonly run: (
    entry: HookRegistryEntry,
    envelope: EnvelopeContext,
  ) => Promise<Outcome>;
}

export interface SpawnProcessOptions {
  readonly cwd: string;
  readonly stdin: Uint8Array;
  readonly stdout: "pipe";
  readonly stderr: "pipe";
}

export interface StreamReader {
  read(): Promise<{ readonly done: boolean; readonly value?: Uint8Array }>;
  cancel?(): Promise<void> | void;
}

export interface SpawnedStream {
  text(): Promise<string>;
  getReader?(): StreamReader;
}

export interface SpawnedProcess {
  readonly exited: Promise<number | null>;
  readonly exitCode?: number | null;
  readonly signalCode?: string | null;
  readonly stdout?: SpawnedStream | null;
  readonly stderr?: SpawnedStream | null;
}

/** Injectable `Bun.spawn` seam; argument arrays only, never a shell string. */
export type SpawnProcess = (
  command: string[],
  options: SpawnProcessOptions,
) => SpawnedProcess;

export interface SubprocessRunnerDeps {
  readonly cwd: string;
  readonly spawn?: SpawnProcess;
}

/* ── Dispatch ─────────────────────────────────────────────────────────────── */

export type HookRunState = "pending" | "success" | "failure";

/** One event's last-known runtime state in the live status snapshot. */
export interface HookRuntimeEntry {
  readonly status: HookRunState;
  readonly startedAt: number;
  readonly finishedAt?: number;
  readonly durationMs?: number;
  readonly reason?: string;
}

/** The single overwritten snapshot consumed by the TUI status poller. */
export interface HookStatusSnapshot {
  readonly version: 1;
  readonly pid: number;
  readonly workspace: string;
  readonly updatedAt: number;
  readonly hooks: Readonly<Record<string, HookRuntimeEntry>>;
}

/** A dispatcher transition reported to the best-effort status observer. */
export interface HookStatusReport {
  readonly entry: HookRegistryEntry;
  readonly phase: "pending" | "settled" | "skipped";
  readonly runId?: string;
  readonly outcome?: Outcome;
  readonly reason?: string;
  /**
   * Wall-clock run start. A settled report without a prior pending uses this
   * start.
   */
  readonly startedAt?: number;
  /**
   * A silent successful catch-all `event` run. The store clears its pending
   * state and restores the previous outcome instead of recording a new one;
   * event-named and one-shot observe runs always record their outcome.
   */
  readonly noop?: boolean;
}

export type HookStatusReadResult =
  | { readonly kind: "missing" | "invalid" }
  | { readonly kind: "ok"; readonly snapshot: HookStatusSnapshot };

/** One settled (or skipped) hook run reported to the append-only log observer. */
export interface HookRunLogReport {
  readonly entry: HookRegistryEntry;
  readonly runId: string;
  readonly phase: "settled" | "skipped";
  readonly outcome?: Outcome;
  readonly reason?: string;
  readonly sessionID?: string;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly capture?: HookCapture;
}

/** One line of the append-only per-workspace JSONL log file. */
export interface HookRunLogRecord {
  readonly version: 1;
  readonly runId: string;
  readonly pid: number;
  readonly workspace: string;
  readonly event: HookEventName;
  readonly hook: string;
  readonly name: string;
  readonly class: HookClass;
  readonly sessionID?: string;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly durationMs: number;
  readonly status: "success" | "failure";
  readonly outcome: OutcomeStatus;
  readonly reason?: string;
  readonly exitCode?: number | null;
  readonly signal?: string | null;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly truncated?: boolean;
}

export type HookLogReadResult =
  | { readonly kind: "missing" | "invalid" }
  | {
      readonly kind: "ok";
      readonly records: readonly HookRunLogRecord[];
      readonly truncated: boolean;
    };

export interface DispatcherOptions {
  readonly run: HookRunner["run"];
  readonly registry: HookRegistry;
  /**
   * Ends the current host session when a gate returns `failed` (as opposed to
   * `blocked`, which only rejects the operation). Injected by the server
   * adapter so the wrapper core stays platform-agnostic.
   */
  readonly endSession?: (sessionID: string) => Promise<void> | void;
  /**
   * Best-effort runtime-status observer. Failures are warned once and never
   * affect gate/observe semantics.
   */
  readonly onStatus?: (report: HookStatusReport) => void;
  /**
   * Best-effort per-run log observer. Independent of the status observer:
   * failures are warned once and never affect gate/observe semantics.
   */
  readonly onRunLog?: (report: HookRunLogReport) => void;
  /** Injectable clock for deterministic duration assertions. */
  readonly now?: () => number;
}

export type Dispatcher = (
  event: HookEventName,
  input?: unknown,
  output?: Record<string, unknown>,
) => Promise<void>;

/* ── Reporting ────────────────────────────────────────────────────────────── */

export interface HookReportRow {
  readonly path: string;
  readonly event: string;
  readonly class: string;
  readonly interpreter: string;
  readonly status: string;
}

export interface HookReportInput {
  readonly entries: readonly HookRegistryEntry[];
  readonly failures?: readonly HookValidationFailure[];
  readonly bypassed?: boolean;
}
