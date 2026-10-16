import { DISPATCHABLE_EVENTS, interpreterName } from "./registry.js";
import type {
  DispatchableEvent,
  EnvelopeContext,
  HookRegistry,
  HookRegistryEntry,
  Outcome,
} from "./registry.js";
import { buildEnvelope } from "./runners.js";
import type { HookRunner } from "./runners.js";

/**
 * Per-event dispatch: the one place where a normalized `Outcome` becomes
 * platform behavior (R5). Gate outcomes throw `Blocked:`-prefixed errors with
 * an actionable `Hint:`; observe outcomes log `[owflow]` and resolve. Failures
 * outside this path keep the documented fail-open posture (R5.4).
 */

const BLOCKED_PREFIX = "Blocked:";

/** R6.5: rich-object events and observe events accept no JSON-representable mutations. */
export const MUTATION_FIELDS: Readonly<
  Record<DispatchableEvent, readonly string[]>
> = {
  "tool.execute.before": ["args"],
  "tool.execute.after": ["title", "output", "metadata"],
  "tool.definition": ["description", "parameters"],
  "chat.message": [],
  "chat.params": [
    "temperature",
    "topP",
    "topK",
    "maxOutputTokens",
    "options",
  ],
  "chat.headers": ["headers"],
  "command.execute.before": [],
  "shell.env": ["env"],
  "experimental.chat.messages.transform": [],
  "experimental.chat.system.transform": ["system"],
  "experimental.session.compacting": ["context"],
  "experimental.compaction.autocontinue": ["enabled"],
  "experimental.text.complete": ["text"],
  config: [],
  event: [],
  dispose: [],
};

export const isWhitelistedMutation = (
  event: DispatchableEvent,
  field: string,
): boolean => MUTATION_FIELDS[event].includes(field);

const warn = (message: string): void => {
  console.warn(`[owflow] hooks: ${message}`);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The event-specific projection of the handler's input/output (R4.3). */
const contextFrom = (
  input: unknown,
  output: unknown,
): Record<string, unknown> => {
  const context: Record<string, unknown> = {};
  for (const source of [input, output]) {
    if (!isRecord(source)) continue;
    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined) context[key] = value;
    }
  }
  return context;
};

const sessionIDFrom = (input: unknown): string | undefined => {
  if (!isRecord(input)) return undefined;
  const sessionID = input.sessionID;
  return typeof sessionID === "string" && sessionID.length > 0
    ? sessionID
    : undefined;
};

const gateRejection = (entry: HookRegistryEntry, outcome: Outcome): Error => {
  const reason = outcome.reason?.trim() ?? "";
  const body =
    reason.length === 0
      ? `${BLOCKED_PREFIX} hook ${entry.path} ${
          outcome.status === "blocked" ? "blocked the operation" : "failed"
        }`
      : reason.startsWith(BLOCKED_PREFIX)
        ? reason
        : `${BLOCKED_PREFIX} ${reason}`;
  const hint =
    outcome.status === "blocked"
      ? `Hint: resolve the condition reported by ${entry.path}, or remove the script and restart OpenCode to disable it.`
      : `Hint: fix the failing script ${entry.path} (failures fail closed), or remove it and restart OpenCode to proceed.`;
  return new Error(`${body.endsWith(".") ? body : `${body}.`} ${hint}`);
};

const missingInterpreterRejection = (entry: HookRegistryEntry): Error => {
  const label = interpreterName(entry.interpreter);
  return new Error(
    `${BLOCKED_PREFIX} hook ${entry.path} cannot run: the ${label} interpreter is not available. ` +
      `Hint: install ${label} and restart OpenCode, or remove the script to stop failing closed.`,
  );
};

/** `experimental.session.compacting` mutates `context` by appending strings only (R6.3). */
const appendContextStrings = (
  entry: HookRegistryEntry,
  value: unknown,
  output: Record<string, unknown>,
): void => {
  if (!Array.isArray(value)) {
    warn(
      `${entry.path} submitted a non-array "context" mutation for experimental.session.compacting; ignored`,
    );
    return;
  }
  const strings = value.filter((item): item is string => typeof item === "string");
  if (strings.length !== value.length) {
    warn(
      `${entry.path} submitted non-string "context" entries for experimental.session.compacting; dropped`,
    );
  }
  if (strings.length === 0) return;
  if (Array.isArray(output.context)) output.context.push(...strings);
  else output.context = [...strings];
};

const applyMutations = (
  event: DispatchableEvent,
  entry: HookRegistryEntry,
  mutations: Record<string, unknown>,
  output: Record<string, unknown>,
): void => {
  for (const [field, value] of Object.entries(mutations)) {
    if (!isWhitelistedMutation(event, field)) {
      warn(
        `${entry.path} submitted non-whitelisted mutation "${field}" for ${event}; ignored`,
      );
      continue;
    }
    if (event === "experimental.session.compacting" && field === "context") {
      appendContextStrings(entry, value, output);
      continue;
    }
    output[field] = value;
  }
};

const runOutcome = async (
  run: HookRunner["run"],
  entry: HookRegistryEntry,
  envelope: EnvelopeContext,
): Promise<Outcome> => {
  try {
    return await run(entry, envelope);
  } catch (error) {
    // Runners normalize their own failures; a raw throw still means failed.
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : "unknown error",
    };
  }
};

export interface DispatcherOptions {
  readonly run: HookRunner["run"];
  readonly registry: HookRegistry;
}

export type Dispatcher = (
  event: DispatchableEvent,
  input?: unknown,
  output?: Record<string, unknown>,
) => Promise<void>;

export const createDispatcher = ({
  run,
  registry,
}: DispatcherOptions): Dispatcher => {
  return async (event, input, output) => {
    const eventEntries = registry.byEvent[event];
    if (eventEntries.length === 0) return;

    const envelope = buildEnvelope({
      event,
      context: contextFrom(input, output),
      sessionID: sessionIDFrom(input),
    });
    const isGate = DISPATCHABLE_EVENTS[event] === "gate";

    for (const entry of eventEntries) {
      if (!entry.interpreter.available) {
        if (isGate) throw missingInterpreterRejection(entry);
        warn(
          `skipping ${entry.path}: the ${interpreterName(entry.interpreter)} interpreter is unavailable`,
        );
        continue;
      }

      const outcome = await runOutcome(run, entry, envelope);

      if (outcome.status !== "ok") {
        if (isGate) throw gateRejection(entry, outcome);
        warn(
          `${entry.path} ${outcome.status}: ${outcome.reason ?? "no reason given"}`,
        );
        continue;
      }

      if (output !== undefined && outcome.mutations !== undefined) {
        applyMutations(event, entry, outcome.mutations, output);
      }
    }
  };
};
