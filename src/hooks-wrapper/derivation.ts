import type {
  DispatchableEvent,
  HookClass,
  HookExtension,
  RunnerClass,
} from "./types.js";

/** Stems accepted by the digest: `[a-z0-9]+(-[a-z0-9]+)*`. */
export const HOOK_STEM_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const HOOK_EXTENSIONS: readonly HookExtension[] = Object.freeze([
  ".ts",
  ".js",
  ".sh",
  ".ps1",
]);

/** Fixed rank decides same-stem collisions; both entries register and run in rank order (A4). */
export const EXTENSION_RANK: Readonly<Record<HookExtension, number>> =
  Object.freeze({
    ".ts": 0,
    ".js": 1,
    ".sh": 2,
    ".ps1": 3,
  });

export const isHookExtension = (value: string): value is HookExtension =>
  (HOOK_EXTENSIONS as readonly string[]).includes(value);

export const runnerClassForExtension = (
  extension: HookExtension,
): RunnerClass =>
  extension === ".sh" || extension === ".ps1" ? "subprocess" : "in-process";

export const toDottedEvent = (stem: string): string =>
  stem.split("-").join(".");

/** The one event table shared by every surface, so classes agree by construction (R6.1). */
export const DISPATCHABLE_EVENTS: Readonly<
  Record<DispatchableEvent, HookClass>
> = Object.freeze({
  "tool.execute.before": "gate",
  "tool.execute.after": "gate",
  "tool.definition": "gate",
  "chat.message": "gate",
  "chat.params": "gate",
  "chat.headers": "gate",
  "command.execute.before": "gate",
  "shell.env": "gate",
  "experimental.chat.messages.transform": "gate",
  "experimental.chat.system.transform": "gate",
  "experimental.session.compacting": "gate",
  "experimental.compaction.autocontinue": "gate",
  "experimental.text.complete": "gate",
  config: "observe",
  event: "observe",
  dispose: "observe",
});

export const DISPATCHABLE_EVENT_NAMES: readonly DispatchableEvent[] =
  Object.freeze(Object.keys(DISPATCHABLE_EVENTS) as DispatchableEvent[]);

/** Names that must never derive to a dispatchable event (R6.2). */
export const EXCLUDED_EVENT_NAMES: readonly string[] = Object.freeze([
  "permission.ask",
  "tool",
  "auth",
  "provider",
  "experimental.provider.small_model",
]);

export const isExcludedEvent = (event: string): boolean =>
  EXCLUDED_EVENT_NAMES.includes(event);

export type HookDerivation =
  | {
      readonly kind: "dispatchable";
      readonly event: DispatchableEvent;
      readonly class: HookClass;
    }
  | { readonly kind: "excluded" }
  | { readonly kind: "unknown"; readonly event: string };

/**
 * Classifies a stem without filesystem access. Excluded names return a marker
 * with no event field so no consumer can mistake them for a dispatchable event.
 */
export const deriveHook = (stem: string): HookDerivation => {
  const event = toDottedEvent(stem);
  if (isExcludedEvent(event)) return { kind: "excluded" };
  if (Object.hasOwn(DISPATCHABLE_EVENTS, event)) {
    return {
      kind: "dispatchable",
      event: event as DispatchableEvent,
      class: DISPATCHABLE_EVENTS[event as DispatchableEvent],
    };
  }
  return { kind: "unknown", event };
};

export interface HookOrderKey {
  readonly event: string;
  readonly stem: string;
  readonly extension: HookExtension;
}

// Plain code-unit comparison keeps ordering identical across locales; the
// registry, CLI, and TUI agree because they all call this comparator.
const compareStrings = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

export const compareHookEntries = (a: HookOrderKey, b: HookOrderKey): number => {
  const byEvent = compareStrings(a.event, b.event);
  if (byEvent !== 0) return byEvent;
  const byStem = compareStrings(a.stem, b.stem);
  if (byStem !== 0) return byStem;
  return EXTENSION_RANK[a.extension] - EXTENSION_RANK[b.extension];
};
