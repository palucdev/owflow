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

export type RunnerClass = "in-process" | "subprocess";

export type HookExtension = ".ts" | ".js" | ".sh" | ".ps1";

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
  | { readonly kind: "excluded" }
  | { readonly kind: "unknown"; readonly event: string };

/* ── Discovery and registration ───────────────────────────────────────────── */

export interface InterpreterResolution {
  readonly resolved?: string;
  readonly expected?: string;
  readonly available: boolean;
}

export type InterpreterAvailability = Readonly<
  Record<HookExtension, InterpreterResolution>
>;

export interface HookScript {
  readonly path: string;
  readonly stem: string;
  readonly event: DispatchableEvent;
  readonly class: HookClass;
  readonly runnerClass: RunnerClass;
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
  readonly event: DispatchableEvent;
  readonly class: HookClass;
  readonly runnerClass: RunnerClass;
  readonly interpreter: InterpreterResolution;
  readonly status: HookEntryStatus;
}

export interface HookRegistry {
  readonly entries: readonly HookRegistryEntry[];
  readonly byEvent: Readonly<
    Record<DispatchableEvent, readonly HookRegistryEntry[]>
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

export interface Outcome {
  readonly status: OutcomeStatus;
  readonly reason?: string;
  readonly mutations?: Record<string, unknown>;
}

export interface EnvelopeContext {
  readonly protocol: "owflow-hooks/1";
  readonly event: DispatchableEvent;
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
  readonly event: DispatchableEvent;
  readonly context: Record<string, unknown>;
  readonly sessionID?: string | undefined;
}

export interface ParsedEnvelopeResult {
  ok: boolean;
  data?: EnvelopeResult;
  error?: string;
}

/* ── Runners ──────────────────────────────────────────────────────────────── */

/** One execution interface for every script class — the v2 seam unit. */
export interface HookRunner {
  readonly run: (
    entry: HookRegistryEntry,
    envelope: EnvelopeContext,
  ) => Promise<Outcome>;
}

export type HookHandler = (envelope: EnvelopeContext) => unknown;

/** Injectable dynamic-import seam; the default is the real `import()`. */
export type ModuleImporter = (specifier: string) => Promise<unknown>;

export interface InProcessRunner extends HookRunner {
  readonly load: (entry: HookRegistryEntry) => Promise<void>;
}

export interface SpawnProcessOptions {
  readonly cwd: string;
  readonly stdin: Uint8Array;
  readonly stdout: "pipe";
  readonly stderr: "pipe";
}

export interface SpawnedStream {
  text(): Promise<string>;
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

export interface ExecutionCoreOptions {
  readonly cwd: string;
  readonly inProcess?: InProcessRunner;
  readonly subprocess?: HookRunner;
}

export interface ExecutionCore extends HookRunner {
  readonly load: (entries: readonly HookRegistryEntry[]) => Promise<void>;
}

/* ── Dispatch ─────────────────────────────────────────────────────────────── */

export interface DispatcherOptions {
  readonly run: HookRunner["run"];
  readonly registry: HookRegistry;
  /**
   * Ends the current host session when a gate returns `failed` (as opposed to
   * `blocked`, which only rejects the operation). Injected by the server
   * adapter so the wrapper core stays platform-agnostic.
   */
  readonly endSession?: (sessionID: string) => Promise<void> | void;
}

export type Dispatcher = (
  event: DispatchableEvent,
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
