import {
  DISPATCHABLE_EVENTS,
  HookEvent,
} from "../types/hook-types.js";
import type {
  DispatchableEvent,
  Dispatcher,
  DispatcherOptions,
  EnvelopeContext,
  HookRegistryEntry,
  HookStatusReport,
  Outcome,
} from "../types/hook-types.js";
import { interpreterName } from "./registry.js";
import { buildEnvelope } from "./runners.js";
import type { HookRunner } from "../types/hook-types.js";
import { BLOCKED_PREFIX, errorMessage, isRecord } from "./shared.js";

export type { Dispatcher, DispatcherOptions };

/**
 * Per-event dispatch: the one place where a normalized `Outcome` becomes
 * platform behavior (R5). Gate outcomes throw `Blocked:`-prefixed errors with
 * an actionable `Hint:`; observe outcomes log `[owflow]` and resolve. Failures
 * outside this path keep the documented fail-open posture (R5.4).
 */

/**
 * Per-event mutation allowlist.
 *
 * The field names are not invented here: each entry mirrors the writable
 * properties of the event's **output parameter** in the host's `Hooks`
 * interface (`@opencode-ai/plugin`, `index.d.ts`), reduced to the values that
 * can travel through JSON. For example:
 *
 * - `tool.execute.before` output is `{ args }`;
 * - `tool.execute.after` output is `{ title, output, metadata }`;
 * - `chat.params` output is `{ temperature, topP, topK, maxOutputTokens, options }`;
 * - `experimental.session.compacting` output is `{ context, prompt? }`, where
 *   only `context` is exposed (append-only strings);
 * - `config`, `event`, and `dispose` are observe events, so they accept none.
 *
 * Events whose output contains rich host objects (`message`, `parts`,
 * `messages`, …) expose no JSON-representable fields and therefore have an
 * empty list. A script can only change the fields listed here; anything else
 * is warned and ignored.
 */
export const MUTATION_FIELDS: Readonly<
  Record<DispatchableEvent, readonly string[]>
> = {
  [HookEvent.ToolExecuteBefore]: ["args"],
  [HookEvent.ToolExecuteAfter]: ["title", "output", "metadata"],
  [HookEvent.ToolDefinition]: ["description", "parameters"],
  [HookEvent.ChatMessage]: [],
  [HookEvent.ChatParams]: [
    "temperature",
    "topP",
    "topK",
    "maxOutputTokens",
    "options",
  ],
  [HookEvent.ChatHeaders]: ["headers"],
  [HookEvent.CommandExecuteBefore]: [],
  [HookEvent.ShellEnv]: ["env"],
  [HookEvent.ExperimentalChatMessagesTransform]: [],
  [HookEvent.ExperimentalChatSystemTransform]: ["system"],
  [HookEvent.ExperimentalSessionCompacting]: ["context"],
  [HookEvent.ExperimentalCompactionAutocontinue]: ["enabled"],
  [HookEvent.ExperimentalTextComplete]: ["text"],
  [HookEvent.Config]: [],
  [HookEvent.Event]: [],
  [HookEvent.Dispose]: [],
};

export const isWhitelistedMutation = (
  event: DispatchableEvent,
  field: string,
): boolean => MUTATION_FIELDS[event].includes(field);

const warn = (message: string): void => {
  console.warn(`[owflow] hooks: ${message}`);
};

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
      : `Hint: fix the failing script ${entry.path} (failure ends the current session; fail closed), or remove it and restart OpenCode to proceed.`;
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
    if (
      event === HookEvent.ExperimentalSessionCompacting &&
      field === "context"
    ) {
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
      reason: errorMessage(error),
    };
  }
};

const endSessionForFailure = async (
  endSession: DispatcherOptions["endSession"],
  sessionID: string | undefined,
  entry: HookRegistryEntry,
): Promise<void> => {
  if (endSession === undefined || sessionID === undefined) return;
  try {
    await endSession(sessionID);
  } catch (error) {
    warn(
      `failed to end session ${sessionID} after ${entry.path} failed: ${errorMessage(error)}`,
    );
  }
};

export const createDispatcher = ({
  run,
  registry,
  endSession,
  onStatus,
}: DispatcherOptions): Dispatcher => {
  let runCounter = 0;
  let statusObserverWarned = false;

  const reportStatus = (report: HookStatusReport): void => {
    if (onStatus === undefined) return;
    try {
      onStatus(report);
    } catch (error) {
      if (!statusObserverWarned) {
        statusObserverWarned = true;
        warn(`status observer failed: ${errorMessage(error)}`);
      }
    }
  };

  return async (event, input, output) => {
    const eventEntries = registry.byEvent[event];
    if (eventEntries.length === 0) return;

    const sessionID = sessionIDFrom(input);
    const envelope = buildEnvelope({
      event,
      context: contextFrom(input, output),
      sessionID,
    });
    const isGate = DISPATCHABLE_EVENTS[event] === "gate";

    for (const entry of eventEntries) {
      if (!entry.interpreter.available) {
        reportStatus({
          entry,
          phase: "skipped",
          reason: `${interpreterName(entry.interpreter)} is not available`,
        });
        if (isGate) {
          await endSessionForFailure(endSession, sessionID, entry);
          throw missingInterpreterRejection(entry);
        }
        warn(
          `skipping ${entry.path}: the ${interpreterName(entry.interpreter)} interpreter is unavailable`,
        );
        continue;
      }

      runCounter += 1;
      const runId = `${event}#${runCounter}`;
      reportStatus({ entry, phase: "pending", runId });

      const outcome = await runOutcome(run, entry, envelope);
      reportStatus({
        entry,
        phase: "settled",
        runId,
        outcome,
        ...(outcome.reason !== undefined ? { reason: outcome.reason } : {}),
      });

      if (outcome.status !== "ok") {
        if (isGate) {
          // A blocked gate only rejects the operation; a failed gate is a
          // broken gate, so the current session must stop as well.
          if (outcome.status === "failed") {
            await endSessionForFailure(endSession, sessionID, entry);
          }
          throw gateRejection(entry, outcome);
        }
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
