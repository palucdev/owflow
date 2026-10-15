import { DISPATCHABLE_EVENT_NAMES, compareHookEntries } from "./derivation.js";
import type {
  DispatchableEvent,
  HookRegistry,
  HookRegistryEntry,
  HookScript,
  InterpreterAvailability,
  InterpreterResolution,
} from "./types.js";

const statusFor = (
  script: HookScript,
  interpreter: InterpreterResolution,
): HookRegistryEntry["status"] => {
  if (interpreter.available) return "registered";
  return script.class === "gate"
    ? "will-fail-closed"
    : "skipped-no-interpreter";
};

const freezeRegistry = (registry: HookRegistry): HookRegistry => {
  for (const entry of registry.entries) {
    Object.freeze(entry.interpreter);
    Object.freeze(entry);
  }
  for (const eventEntries of Object.values(registry.byEvent))
    Object.freeze(eventEntries);
  Object.freeze(registry.byEvent);
  Object.freeze(registry.entries);
  return Object.freeze(registry);
};

/**
 * Builds the single frozen source of truth for dispatch and every report
 * surface. Entries arrive sorted by `(event, stem, extension rank)` so all
 * surfaces agree by construction (R2.2); nothing is persisted.
 */
export const buildRegistry = (
  scripts: readonly HookScript[],
  availability: InterpreterAvailability,
): HookRegistry => {
  const entries: HookRegistryEntry[] = [...scripts]
    .sort(compareHookEntries)
    .map((script) => {
      const interpreter = { ...availability[script.extension] };
      return {
        path: script.path,
        event: script.event,
        class: script.class,
        runnerClass: script.runnerClass,
        interpreter,
        status: statusFor(script, interpreter),
      };
    });

  const byEvent = {} as Record<DispatchableEvent, HookRegistryEntry[]>;
  for (const event of DISPATCHABLE_EVENT_NAMES) byEvent[event] = [];
  for (const entry of entries) byEvent[entry.event].push(entry);

  return freezeRegistry({ entries, byEvent });
};
