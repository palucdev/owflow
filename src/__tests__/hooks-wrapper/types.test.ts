import { describe, expect, test } from "bun:test";
import type {
  EnvelopeContext,
  HookRegistryEntry,
  HookScript,
  Outcome,
} from "../../hooks-wrapper/types.js";

/** Type-only module; this suite keeps the mirror map complete (R12.1). */
describe("hooks-wrapper vocabulary", () => {
  test("should pin outcome, envelope, script, and registry entry shapes", () => {
    const outcome = { status: "blocked" } satisfies Outcome;
    const envelope = {
      protocol: "owflow-hooks/1",
      event: "tool.execute.before",
      class: "gate",
      session: { sessionID: "ses_test" },
      context: {},
    } satisfies EnvelopeContext;
    const script = {
      path: "/p/tool-execute-before.ts",
      stem: "tool-execute-before",
      event: "tool.execute.before",
      class: "gate",
      runnerClass: "in-process",
      extension: ".ts",
    } satisfies HookScript;
    const entry = {
      path: script.path,
      event: script.event,
      class: script.class,
      runnerClass: script.runnerClass,
      interpreter: { available: true },
      status: "registered",
    } satisfies HookRegistryEntry;

    expect([outcome.status, envelope.protocol, entry.status, script.extension])
      .toEqual(["blocked", "owflow-hooks/1", "registered", ".ts"]);
  });
});
