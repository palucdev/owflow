export enum HookEvent {
  ToolExecuteBefore = 'tool.execute.before',
  ToolExecuteAfter = 'tool.execute.after',
  ToolDefinition = 'tool.definition',
  ChatMessage = 'chat.message',
  ChatParams = 'chat.params',
  ChatHeaders = 'chat.headers',
  CommandExecuteBefore = 'command.execute.before',
  ShellEnv = 'shell.env',
  ExperimentalChatMessagesTransform = 'experimental.chat.messages.transform',
  ExperimentalChatSystemTransform = 'experimental.chat.system.transform',
  ExperimentalSessionCompacting = 'experimental.session.compacting',
  ExperimentalCompactionAutocontinue = 'experimental.compaction.autocontinue',
  ExperimentalTextComplete = 'experimental.text.complete',
  Config = 'config',
  Event = 'event',
  Dispose = 'dispose',
}

export type DispatchableEvent = `${HookEvent}`;

export const DISPATCHABLE_EVENTS: readonly DispatchableEvent[] = Object.values(HookEvent);

export enum HostEventName {
  CommandExecuted = 'command.executed',
  FileEdited = 'file.edited',
  FileWatcherUpdated = 'file.watcher.updated',
  InstallationUpdateAvailable = 'installation.update-available',
  InstallationUpdated = 'installation.updated',
  LSPClientDiagnostics = 'lsp.client.diagnostics',
  LSPUpdated = 'lsp.updated',
  MessagePartRemoved = 'message.part.removed',
  MessagePartUpdated = 'message.part.updated',
  MessageRemoved = 'message.removed',
  MessageUpdated = 'message.updated',
  PermissonReplied = 'permission.replied',
  PermissionUpdated = 'permission.updated',
  VirtualTerminalCreated = 'pty.created',
  VirtualTerminalDeleted = 'pty.deleted',
  VirtualTerminalExited = 'pty.exited',
  VirtualTerminalUpdated = 'pty.updated',
  ServerConnected = 'server.connected',
  ServerInstanceDisposed = 'server.instance.disposed',
  SessionCompated = 'session.compacted',
  SessionCreated = 'session.created',
  SessionDeleted = 'session.deleted',
  SessionDiff = 'session.diff',
  SessionError = 'session.error',
  SessionIdle = 'session.idle',
  SessionStatus = 'session.status',
  SessionUpdated = 'session.updated',
  ToDoUpdated = 'todo.updated',
  TUICommandExecute = 'tui.command.execute',
  TUIPromptAppend = 'tui.prompt.append',
  TUIToastShow = 'tui.toast.show',
  VSCBranchUpdated = 'vcs.branch.updated',
}

export const HOST_EVENT_NAMES = Object.values(HostEventName);

export type HookEventName = DispatchableEvent | HostEventName;

export const HOOK_EVENT_NAMES: readonly HookEventName[] = [...DISPATCHABLE_EVENTS, ...HOST_EVENT_NAMES];

export const EXCLUDED_EVENT_NAMES = ['permission.ask', 'tool', 'auth', 'provider', 'experimental.provider.small_model'] as const;

export const isHostEventName = (value: string): boolean => {
  return HOST_EVENT_NAMES.includes(value as HostEventName);
};

/**
Validation digest mode for `scanHooks`.
- `FailFast`: Throws on any validation failure at startup/runtime to prevent
  running with invalid or ambiguous hooks (fail-closed contract).
- `Report`: Collects failures without throwing, allowing UI surfaces (TUI sidebar)
  and test suites to safely inspect hook status without crashing the process.
*/
export enum HookDigestMode {
  FailFast = 'fail-fast',
  Report = 'report',
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
  readonly status: 'registered' | 'will-fail-closed';
}

export interface HookValidationFailure {
  readonly path: string;
  readonly error: string;
}

export interface HookScan {
  readonly entries: readonly HookRegistryEntry[];
  readonly failures: readonly HookValidationFailure[];
}

export enum HookRunState {
  IDLE = 'idle',
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILURE = 'failure',
}

export interface HookRuntimeEntry {
  readonly status: HookRunState;
  readonly startedAt: number;
  readonly finishedAt?: number;
  readonly durationMs?: number;
  readonly reason?: string;
  readonly sessionID?: string;
}

export interface HookStatusSnapshot {
  readonly version: 1;
  readonly pid: number;
  readonly workspace: string;
  readonly updatedAt: number;
  readonly hooks: Readonly<Record<string, HookRuntimeEntry>>;
}

export type HookStatusReadResult = { readonly kind: 'missing' | 'invalid' } | { readonly kind: 'ok'; readonly snapshot: HookStatusSnapshot };

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
  readonly status: HookRunState;
  readonly exitCode?: number | null;
  readonly signal?: string | null;
  readonly reason?: string;
  readonly stdout?: string;
  readonly stderr?: string;
}

export type HookLogReadResult =
  { readonly kind: 'missing' | 'invalid' } | { readonly kind: 'ok'; readonly records: readonly HookRunLogRecord[]; readonly truncated: boolean };

export interface HookRunOptions {
  readonly event: HookEventName;
  readonly input?: unknown;
  readonly output?: unknown;
}

export type HookRunCallback = (options: HookRunOptions) => Promise<void>;

export type HookReportRow = Readonly<Record<'path' | 'event' | 'interpreter' | 'status', string>>;

export interface HookReportInput {
  readonly entries: readonly HookRegistryEntry[];
  readonly failures?: readonly HookValidationFailure[];
  readonly bypassed?: boolean;
}

export interface HooksWrapper {
  readonly runHook: HookRunCallback;
  readonly snapshot: HookReportInput;
  dispose(): void;
}

export interface HooksWrapperOptions {
  readonly statusFile?: string;
  readonly logFile?: string;
  readonly endSession?: (sessionID: string) => Promise<void> | void;
}
