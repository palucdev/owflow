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

export interface HooksWrapper {
  readonly dispatch: Dispatcher;
  readonly snapshot: HookReportInput;
  dispose(): void;
}

export interface HooksWrapperOptions {
  readonly statusFile?: string;
  readonly logFile?: string;
}
