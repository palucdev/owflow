/**
 * Shared vocabulary for the hooks wrapper. Every module under
 * `src/hooks-wrapper/` stays platform-agnostic by contract (R11.1): no
 * host-framework imports or identifiers anywhere in these modules.
 */

export type HookClass = "gate" | "observe";

export type RunnerClass = "in-process" | "subprocess";

export type HookExtension = ".ts" | ".js" | ".sh" | ".ps1";

export type DispatchableEvent =
  | "tool.execute.before"
  | "tool.execute.after"
  | "tool.definition"
  | "chat.message"
  | "chat.params"
  | "chat.headers"
  | "command.execute.before"
  | "shell.env"
  | "experimental.chat.messages.transform"
  | "experimental.chat.system.transform"
  | "experimental.session.compacting"
  | "experimental.compaction.autocontinue"
  | "experimental.text.complete"
  | "config"
  | "event"
  | "dispose";

export type HookEntryStatus =
  | "registered"
  | "will-fail-closed"
  | "skipped-no-interpreter";

export interface InterpreterResolution {
  readonly resolved?: string;
  /** First candidate name, recorded when nothing resolved (R2.2 report labels). */
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

export type HookDigestMode = "throw" | "report";

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

export type OutcomeStatus = "ok" | "blocked" | "failed";

export interface Outcome {
  readonly status: OutcomeStatus;
  readonly reason?: string;
  readonly mutations?: Record<string, unknown>;
}

export interface EnvelopeSession {
  readonly sessionID: string;
}

export interface EnvelopeContext {
  readonly protocol: "owflow-hooks/1";
  readonly event: DispatchableEvent;
  readonly class: HookClass;
  readonly session?: EnvelopeSession;
  readonly context: Record<string, unknown>;
}

export interface EnvelopeResult {
  readonly protocol: "owflow-hooks/1";
  readonly status: OutcomeStatus;
  readonly reason?: string;
  readonly mutations?: Record<string, unknown>;
}
