import { describe, expect, test } from "bun:test";
import {
  DISPATCHABLE_EVENT_NAMES,
  DISPATCHABLE_EVENTS,
  EXCLUDED_EVENT_NAMES,
  EXTENSION_RANK,
  HOOK_EXTENSIONS,
  deriveHook,
  isHookExtension,
  runnerClassForExtension,
  toDottedEvent,
} from "../../hooks-wrapper/derivation.js";

describe("toDottedEvent", () => {
  test("should map every kebab segment of a stem to a dotted event segment", () => {
    expect(toDottedEvent("tool-execute-before")).toBe("tool.execute.before");
    expect(toDottedEvent("experimental-chat-messages-transform")).toBe(
      "experimental.chat.messages.transform",
    );
    expect(toDottedEvent("config")).toBe("config");
  });
});

describe("extension routing", () => {
  test("should route each extension to its runner class at the pinned extension rank", () => {
    expect(runnerClassForExtension(".ts")).toBe("in-process");
    expect(runnerClassForExtension(".js")).toBe("in-process");
    expect(runnerClassForExtension(".sh")).toBe("subprocess");
    expect(runnerClassForExtension(".ps1")).toBe("subprocess");

    expect(
      HOOK_EXTENSIONS.map((extension) => EXTENSION_RANK[extension]),
    ).toEqual([0, 1, 2, 3]);

    expect(isHookExtension(".ts")).toBe(true);
    expect(isHookExtension(".ps1")).toBe(true);
    expect(isHookExtension(".md")).toBe(false);
    expect(isHookExtension("ts")).toBe(false);
  });
});

describe("deriveHook", () => {
  test("should classify the 16 dispatchable events and mark excluded names without a dotted event", () => {
    expect(new Set(DISPATCHABLE_EVENT_NAMES)).toEqual(
      new Set([
        "tool.execute.before",
        "tool.execute.after",
        "tool.definition",
        "chat.message",
        "chat.params",
        "chat.headers",
        "command.execute.before",
        "shell.env",
        "experimental.chat.messages.transform",
        "experimental.chat.system.transform",
        "experimental.session.compacting",
        "experimental.compaction.autocontinue",
        "experimental.text.complete",
        "config",
        "event",
        "dispose",
      ]),
    );

    const classes = Object.values(DISPATCHABLE_EVENTS);
    expect(classes.filter((hookClass) => hookClass === "gate")).toHaveLength(13);
    expect(classes.filter((hookClass) => hookClass === "observe")).toHaveLength(
      3,
    );

    expect(deriveHook("tool-execute-before")).toEqual({
      kind: "dispatchable",
      event: "tool.execute.before",
      class: "gate",
    });
    expect(deriveHook("config")).toEqual({
      kind: "dispatchable",
      event: "config",
      class: "observe",
    });

    expect(new Set(EXCLUDED_EVENT_NAMES)).toEqual(
      new Set([
        "permission.ask",
        "tool",
        "auth",
        "provider",
        "experimental.provider.small_model",
      ]),
    );
    for (const excludedEvent of EXCLUDED_EVENT_NAMES) {
      expect(Object.hasOwn(DISPATCHABLE_EVENTS, excludedEvent)).toBe(false);
    }

    for (const excluded of ["permission-ask", "tool", "auth", "provider"]) {
      expect(deriveHook(excluded)).toEqual({ kind: "excluded" });
    }
    // Only the exact transform form of the snake_case excluded event carries
    // the underscore through the mechanical kebab→dotted mapping.
    expect(deriveHook("experimental-provider-small_model")).toEqual({
      kind: "excluded",
    });

    expect(deriveHook("tool-execute-befor")).toEqual({
      kind: "unknown",
      event: "tool.execute.befor",
    });
  });
});
