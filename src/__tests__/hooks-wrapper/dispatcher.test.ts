import { describe, expect, spyOn, test } from "bun:test";
import {
  createDispatcher,
  isWhitelistedMutation,
  MUTATION_FIELDS,
} from "../../hooks-wrapper/dispatcher.js";
import type { Dispatcher } from "../../hooks-wrapper/dispatcher.js";
import {
  DISPATCHABLE_EVENT_NAMES,
  buildRegistry,
} from "../../hooks-wrapper/registry.js";
import type {
  DispatchableEvent,
  EnvelopeContext,
  HookRegistry,
  HookRegistryEntry,
  HookScript,
  InterpreterAvailability,
  Outcome,
} from "../../hooks-wrapper/registry.js";
import type { HookStatusReport } from "../../types/hook-types.js";

const entry = (
  overrides: Partial<HookRegistryEntry> = {},
): HookRegistryEntry => ({
  path: "/project/.owflow/hooks/tool-execute-before.ts",
  event: "tool.execute.before",
  class: "gate",
  runnerClass: "in-process",
  interpreter: { available: true },
  status: "registered",
  ...overrides,
});

const script = (overrides: Partial<HookScript> = {}): HookScript => ({
  path: "/project/.owflow/hooks/tool-execute-before.ts",
  stem: "tool-execute-before",
  event: "tool.execute.before",
  class: "gate",
  runnerClass: "in-process",
  extension: ".ts",
  ...overrides,
});

const AVAILABLE: InterpreterAvailability = {
  ".ts": { available: true },
  ".js": { available: true },
  ".sh": { resolved: "/usr/bin/bash", available: true },
  ".ps1": { resolved: "/usr/bin/pwsh", available: true },
};

const registryOf = (entries: readonly HookRegistryEntry[]): HookRegistry => {
  const byEvent = {} as Record<DispatchableEvent, HookRegistryEntry[]>;
  for (const event of DISPATCHABLE_EVENT_NAMES) byEvent[event] = [];
  for (const hookEntry of entries) byEvent[hookEntry.event].push(hookEntry);
  return { entries, byEvent };
};

interface Harness {
  readonly dispatch: Dispatcher;
  readonly calls: Array<{ entry: HookRegistryEntry; envelope: EnvelopeContext }>;
  readonly endedSessions: string[];
}

const harness = (
  registry: HookRegistry,
  outcomes: readonly (Outcome | Error)[],
  endSession?: (sessionID: string) => Promise<void> | void,
): Harness => {
  const calls: Harness["calls"] = [];
  const endedSessions: string[] = [];
  let index = 0;
  const run = async (
    hookEntry: HookRegistryEntry,
    envelope: EnvelopeContext,
  ): Promise<Outcome> => {
    calls.push({ entry: hookEntry, envelope });
    const next = outcomes[index++];
    if (next instanceof Error) throw next;
    return next ?? { status: "ok" };
  };
  return {
    dispatch: createDispatcher({
      run,
      registry,
      endSession:
        endSession === undefined
          ? (sessionID) => {
              endedSessions.push(sessionID);
            }
          : endSession,
    }),
    calls,
    endedSessions,
  };
};

const rejectionMessage = async (
  dispatch: Dispatcher,
  event: DispatchableEvent,
  input: unknown,
  output?: Record<string, unknown>,
): Promise<string> => {
  try {
    await dispatch(event, input, output);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected dispatch to reject");
};

const warningTexts = (calls: readonly unknown[][]): string[] =>
  calls.map((call) => String(call[0]));

describe("gate translation", () => {
  test("should reject a blocked gate outcome with a Blocked:-prefixed Error carrying an actionable Hint", async () => {
    const execution = harness(
      buildRegistry([script()], AVAILABLE),
      [
        { status: "blocked", reason: "rm -rf is not allowed for this agent" },
        {
          status: "blocked",
          reason: "Blocked: already prefixed by a nested block",
        },
      ],
    );

    const message = await rejectionMessage(
      execution.dispatch,
      "tool.execute.before",
      { tool: "bash", sessionID: "ses_1" },
      { args: { command: "rm -rf build" } },
    );

    expect(message.startsWith("Blocked:")).toBe(true);
    expect(message).toContain("rm -rf is not allowed for this agent");
    expect(message).toContain("Hint:");
    expect(message.match(/Blocked:/g)).toHaveLength(1);

    // The envelope carries the derived class, session, and merged input/output context.
    expect(execution.calls).toHaveLength(1);
    expect(execution.calls[0]!.envelope).toEqual({
      protocol: "owflow-hooks/1",
      event: "tool.execute.before",
      class: "gate",
      session: { sessionID: "ses_1" },
      context: {
        tool: "bash",
        sessionID: "ses_1",
        args: { command: "rm -rf build" },
      },
    });

    // The in-process runner strips the prefix; the dispatcher re-prefixes once.
    const prefixed = await rejectionMessage(
      execution.dispatch,
      "tool.execute.before",
      { tool: "bash" },
      { args: {} },
    );
    expect(prefixed.startsWith("Blocked:")).toBe(true);
    expect(prefixed.startsWith("Blocked: Blocked:")).toBe(false);
    expect(prefixed.match(/Blocked:/g)).toHaveLength(1);
    expect(prefixed).toContain("already prefixed by a nested block");
  });

  test("should fail closed by translating a failed gate outcome into a Blocked:-prefixed throw with a Hint", async () => {
    const execution = harness(
      registryOf([entry()]),
      [{ status: "failed", reason: "missing jq" }],
    );

    const message = await rejectionMessage(
      execution.dispatch,
      "tool.execute.before",
      { tool: "bash" },
      { args: {} },
    );

    expect(message.startsWith("Blocked:")).toBe(true);
    expect(message).toContain("missing jq");
    expect(message).toContain("Hint:");
    expect(execution.calls).toHaveLength(1);

    const reasonless = harness(registryOf([entry()]), [{ status: "failed" }]);
    const fallback = await rejectionMessage(
      reasonless.dispatch,
      "tool.execute.before",
      { tool: "bash" },
      { args: {} },
    );
    expect(fallback.startsWith("Blocked:")).toBe(true);
    expect(fallback).toContain("Hint:");
    expect(fallback).toContain("/project/.owflow/hooks/tool-execute-before.ts");

    // A raw throw from the execution core must still fail closed for the agent.
    const throwing = harness(
      registryOf([entry()]),
      [new Error("runner exploded")],
    );
    const thrownMessage = await rejectionMessage(
      throwing.dispatch,
      "tool.execute.before",
      { tool: "bash" },
      { args: {} },
    );
    expect(thrownMessage.startsWith("Blocked:")).toBe(true);
    expect(thrownMessage).toContain("runner exploded");
    expect(thrownMessage).toContain("Hint:");
  });

  test("should end the current session for a failed gate but not for a blocked gate", async () => {
    const failed = harness(registryOf([entry()]), [
      { status: "failed", reason: "missing jq" },
    ]);
    await rejectionMessage(
      failed.dispatch,
      "tool.execute.before",
      { tool: "bash", sessionID: "ses_failed" },
      { args: {} },
    );
    expect(failed.endedSessions).toEqual(["ses_failed"]);

    const blocked = harness(registryOf([entry()]), [
      { status: "blocked", reason: "policy says no" },
    ]);
    await rejectionMessage(
      blocked.dispatch,
      "tool.execute.before",
      { tool: "bash", sessionID: "ses_blocked" },
      { args: {} },
    );
    expect(blocked.endedSessions).toEqual([]);
  });

  test("should warn and still reject when ending the session fails", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const failed = harness(
        registryOf([entry()]),
        [{ status: "failed", reason: "missing jq" }],
        async () => {
          throw new Error("abort endpoint down");
        },
      );
      const message = await rejectionMessage(
        failed.dispatch,
        "tool.execute.before",
        { tool: "bash", sessionID: "ses_failed" },
        { args: {} },
      );

      expect(message).toContain("missing jq");
      const warnings = warningTexts(warnSpy.mock.calls);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("abort endpoint down");
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("observe translation", () => {
  test("should log failed and blocked observe outcomes with the [owflow] prefix and resolve without propagating", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const failedEntry = entry({
        path: "/project/.owflow/hooks/event.ts",
        event: "event",
        class: "observe",
      });
      const blockedEntry = entry({
        path: "/project/.owflow/hooks/dispose.ts",
        event: "dispose",
        class: "observe",
      });
      const execution = harness(registryOf([failedEntry, blockedEntry]), [
        { status: "failed", reason: "telemetry exploded" },
        { status: "blocked", reason: "policy says no" },
      ]);

      await expect(
        execution.dispatch("event", { type: "session.idle" }),
      ).resolves.toBeUndefined();
      await expect(
        execution.dispatch("dispose", { reason: "shutdown" }),
      ).resolves.toBeUndefined();

      expect(execution.calls).toHaveLength(2);
      const warnings = warningTexts(warnSpy.mock.calls);
      expect(warnings).toHaveLength(2);
      expect(warnings[0]!.startsWith("[owflow]")).toBe(true);
      expect(warnings[0]).toContain("telemetry exploded");
      expect(warnings[1]!.startsWith("[owflow]")).toBe(true);
      expect(warnings[1]).toContain("policy says no");

      const okExecution = harness(
        registryOf([entry({ event: "event", class: "observe" })]),
        [{ status: "ok" }],
      );
      await expect(
        okExecution.dispatch("event", { type: "session.idle" }),
      ).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledTimes(2);

      // A raw throw from the execution core is a failed outcome, never a propagation.
      const throwingExecution = harness(
        registryOf([entry({ event: "dispose", class: "observe" })]),
        [new Error("runner exploded")],
      );
      await expect(
        throwingExecution.dispatch("dispose", { reason: "shutdown" }),
      ).resolves.toBeUndefined();
      const afterThrow = warningTexts(warnSpy.mock.calls);
      expect(afterThrow).toHaveLength(3);
      expect(afterThrow[2]!.startsWith("[owflow]")).toBe(true);
      expect(afterThrow[2]).toContain("runner exploded");
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("missing interpreter at fire", () => {
  test("should fail closed when a gate entry's interpreter is missing and skip-log an observe entry", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const gateEntry = entry({
        path: "/project/.owflow/hooks/tool-execute-before.sh",
        runnerClass: "subprocess",
        interpreter: { expected: "bash", available: false },
        status: "will-fail-closed",
      });
      const observeEntry = entry({
        path: "/project/.owflow/hooks/config.sh",
        event: "config",
        class: "observe",
        runnerClass: "subprocess",
        interpreter: { expected: "bash", available: false },
        status: "skipped-no-interpreter",
      });
      const execution = harness(registryOf([gateEntry, observeEntry]), []);

      const message = await rejectionMessage(
        execution.dispatch,
        "tool.execute.before",
        { tool: "bash", sessionID: "ses_missing" },
        { args: {} },
      );
      expect(message.startsWith("Blocked:")).toBe(true);
      expect(message).toContain("bash");
      expect(message).toContain("Hint:");
      expect(execution.endedSessions).toEqual(["ses_missing"]);

      await expect(execution.dispatch("config", {})).resolves.toBeUndefined();
      const warnings = warningTexts(warnSpy.mock.calls);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.startsWith("[owflow]")).toBe(true);
      expect(warnings[0]).toContain("config.sh");

      // A script with no interpreter is never handed to the execution core.
      expect(execution.calls).toHaveLength(0);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("runtime status observer", () => {
  test("should report pending before the run and settled after a successful run", async () => {
    const order: string[] = [];
    const reports: HookStatusReport[] = [];
    const dispatch = createDispatcher({
      run: async () => {
        order.push("run");
        return { status: "ok" };
      },
      registry: registryOf([entry()]),
      onStatus: (report) => {
        order.push(report.phase);
        reports.push(report);
      },
    });

    await dispatch(
      "tool.execute.before",
      { tool: "bash" },
      { args: { command: "ls" } },
    );

    expect(order).toEqual(["pending", "run", "settled"]);
    expect(reports).toHaveLength(2);
    expect(reports[0]?.runId).toMatch(/^tool\.execute\.before#\d+$/);
    expect(reports[1]?.runId).toBe(reports[0]?.runId);
    expect(reports[1]?.outcome).toEqual({ status: "ok" });
  });

  test("should report blocked and failed gates before rejecting or ending the session", async () => {
    const blockedOrder: string[] = [];
    const blockedDispatch = createDispatcher({
      run: async () => ({ status: "blocked", reason: "policy says no" }),
      registry: registryOf([entry()]),
      onStatus: (report) => {
        blockedOrder.push(
          `${report.phase}:${report.outcome?.status ?? report.reason ?? ""}`,
        );
      },
    });

    await expect(
      blockedDispatch("tool.execute.before", { tool: "bash" }),
    ).rejects.toThrow("policy says no");
    expect(blockedOrder).toEqual(["pending:", "settled:blocked"]);

    const failedOrder: string[] = [];
    const failedDispatch = createDispatcher({
      run: async () => ({ status: "failed", reason: "gate broke" }),
      registry: registryOf([entry()]),
      endSession: () => {
        failedOrder.push("end-session");
      },
      onStatus: (report) => {
        failedOrder.push(`status:${report.phase}`);
      },
    });

    await expect(
      failedDispatch(
        "tool.execute.before",
        { tool: "bash", sessionID: "ses_failed" },
        { args: {} },
      ),
    ).rejects.toThrow("gate broke");
    expect(failedOrder).toEqual([
      "status:pending",
      "status:settled",
      "end-session",
    ]);
  });

  test("should report a missing gate interpreter as skipped and still fail closed", async () => {
    const reports: HookStatusReport[] = [];
    const ended: string[] = [];
    const missing = entry({
      path: "/project/.owflow/hooks/tool-execute-before.sh",
      runnerClass: "subprocess",
      interpreter: { expected: "bash", available: false },
      status: "will-fail-closed",
    });
    const dispatch = createDispatcher({
      run: async () => {
        throw new Error("must not run");
      },
      registry: registryOf([missing]),
      endSession: (sessionID) => {
        ended.push(sessionID);
      },
      onStatus: (report) => reports.push(report),
    });

    const message = await rejectionMessage(
      dispatch,
      "tool.execute.before",
      { tool: "bash", sessionID: "ses_missing" },
      { args: {} },
    );

    expect(message.startsWith("Blocked:")).toBe(true);
    expect(ended).toEqual(["ses_missing"]);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.phase).toBe("skipped");
    expect(reports[0]?.reason).toContain("bash is not available");
  });

  test("should report a missing observe interpreter as skipped and continue", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const reports: HookStatusReport[] = [];
      const missing = entry({
        path: "/project/.owflow/hooks/config.sh",
        event: "config",
        class: "observe",
        runnerClass: "subprocess",
        interpreter: { expected: "bash", available: false },
        status: "skipped-no-interpreter",
      });
      const dispatch = createDispatcher({
        run: async () => {
          throw new Error("must not run");
        },
        registry: registryOf([missing]),
        onStatus: (report) => reports.push(report),
      });

      await expect(dispatch("config", {})).resolves.toBeUndefined();

      expect(reports).toHaveLength(1);
      expect(reports[0]?.phase).toBe("skipped");
      expect(reports[0]?.reason).toContain("bash is not available");
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  test("should warn once and preserve semantics when the observer throws", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const ended: string[] = [];
      const dispatch = createDispatcher({
        run: async () => ({ status: "failed", reason: "gate broke" }),
        registry: registryOf([entry()]),
        endSession: (sessionID) => {
          ended.push(sessionID);
        },
        onStatus: () => {
          throw new Error("observer exploded");
        },
      });

      await expect(
        dispatch(
          "tool.execute.before",
          { tool: "bash", sessionID: "ses_failed" },
          { args: {} },
        ),
      ).rejects.toThrow("gate broke");
      expect(ended).toEqual(["ses_failed"]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("observer exploded");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("mutation whitelist", () => {
  test("should apply whitelisted mutations, warn-and-ignore the rest, and never mutate observe outputs", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      // R6.5 table shape: one entry per dispatchable event; rich-object and
      // observe events accept no JSON-representable mutations.
      expect(Object.keys(MUTATION_FIELDS).sort()).toEqual(
        [...DISPATCHABLE_EVENT_NAMES].sort(),
      );
      expect(isWhitelistedMutation("tool.execute.before", "args")).toBe(true);
      expect(isWhitelistedMutation("tool.execute.before", "command")).toBe(
        false,
      );
      expect(MUTATION_FIELDS["chat.message"]).toEqual([]);
      expect(MUTATION_FIELDS["config"]).toEqual([]);

      // A whitelisted field lands on the shared output; the rest warns and drops.
      const beforeExecution = harness(
        registryOf([entry()]),
        [
          {
            status: "ok",
            mutations: { args: { command: "ls -la" }, command: "nope" },
          },
        ],
      );
      const beforeOutput: Record<string, unknown> = {
        args: { command: "rm -rf build" },
      };
      await beforeExecution.dispatch(
        "tool.execute.before",
        { tool: "bash" },
        beforeOutput,
      );
      expect(beforeOutput).toEqual({ args: { command: "ls -la" } });
      const beforeWarnings = warningTexts(warnSpy.mock.calls);
      expect(beforeWarnings).toHaveLength(1);
      expect(beforeWarnings[0]!.startsWith("[owflow]")).toBe(true);
      expect(beforeWarnings[0]).toContain('"command"');

      // Rich-object events take no mutations at all.
      const chatEntry = entry({
        path: "/project/.owflow/hooks/chat-message.ts",
        event: "chat.message",
        class: "gate",
      });
      const chatExecution = harness(
        registryOf([chatEntry]),
        [
          {
            status: "ok",
            mutations: { parts: [{ id: "prt_evil" }], message: {} },
          },
        ],
      );
      const chatOutput: Record<string, unknown> = {
        message: { id: "msg_1" },
        parts: [{ id: "prt_1" }],
      };
      await chatExecution.dispatch(
        "chat.message",
        { sessionID: "ses_1" },
        chatOutput,
      );
      expect(chatOutput).toEqual({
        message: { id: "msg_1" },
        parts: [{ id: "prt_1" }],
      });

      // `context` is append-only: the built-in reminder is never replaced.
      const compactEntry = entry({
        path: "/project/.owflow/hooks/experimental-session-compacting.ts",
        event: "experimental.session.compacting",
        class: "gate",
      });
      const compactExecution = harness(
        registryOf([compactEntry]),
        [{ status: "ok", mutations: { context: ["script reminder"] } }],
      );
      const compactOutput: Record<string, unknown> = {
        context: ["built-in reminder"],
        prompt: "keep me",
      };
      await compactExecution.dispatch(
        "experimental.session.compacting",
        {},
        compactOutput,
      );
      expect(compactOutput.context).toEqual([
        "built-in reminder",
        "script reminder",
      ]);
      expect(compactOutput.prompt).toBe("keep me");

      // Observe events apply no mutations at all.
      const observeEntry = entry({
        path: "/project/.owflow/hooks/config.ts",
        event: "config",
        class: "observe",
      });
      const observeExecution = harness(
        registryOf([observeEntry]),
        [{ status: "ok", mutations: { enabled: false } }],
      );
      const observeOutput: Record<string, unknown> = { model: "keep" };
      await observeExecution.dispatch("config", {}, observeOutput);
      expect(observeOutput).toEqual({ model: "keep" });

      // One warning for "command", two rich-object fields, one observe mutation.
      const allWarnings = warningTexts(warnSpy.mock.calls);
      expect(allWarnings).toHaveLength(4);
      expect(allWarnings.every((line) => line.startsWith("[owflow]"))).toBe(
        true,
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
