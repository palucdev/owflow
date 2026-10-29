import { describe, expect, spyOn, test } from "bun:test";
import {
  createDispatcher,
  isWhitelistedMutation,
  MUTATION_FIELDS,
} from "../../hooks-wrapper/dispatcher.js";
import type { Dispatcher } from "../../hooks-wrapper/dispatcher.js";
import {
  DISPATCHABLE_EVENT_NAMES,
  HOOK_EVENT_NAMES,
  buildRegistry,
} from "../../hooks-wrapper/registry.js";
import type {
  DispatchableEvent,
  EnvelopeContext,
  HookEventName,
  HookRegistry,
  HookRegistryEntry,
  HookScript,
  InterpreterAvailability,
  Outcome,
} from "../../hooks-wrapper/registry.js";
import type {
  HookRunLogReport,
  HookStatusReport,
} from "../../types/hook-types.js";

const entry = (
  overrides: Partial<HookRegistryEntry> = {},
): HookRegistryEntry => ({
  path: "/project/.owflow/hooks/tool-execute-before.sh",
  event: "tool.execute.before",
  interpreter: { resolved: "/usr/bin/bash", available: true },
  status: "registered",
  ...overrides,
});

const script = (overrides: Partial<HookScript> = {}): HookScript => ({
  path: "/project/.owflow/hooks/tool-execute-before.sh",
  stem: "tool-execute-before",
  event: "tool.execute.before",
  extension: ".sh",
  ...overrides,
});

const AVAILABLE: InterpreterAvailability = {
  ".sh": { resolved: "/usr/bin/bash", available: true },
  ".ps1": { resolved: "/usr/bin/pwsh", available: true },
};

const registryOf = (entries: readonly HookRegistryEntry[]): HookRegistry => {
  const byEvent = {} as Record<HookEventName, HookRegistryEntry[]>;
  for (const event of HOOK_EVENT_NAMES) byEvent[event] = [];
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
  event: HookEventName,
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

    // A script may already prefix its reason; the dispatcher re-prefixes once.
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
    expect(fallback).toContain("/project/.owflow/hooks/tool-execute-before.sh");

    // A raw throw from the runner must still fail closed for the agent.
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

describe("universal gate fail-closed semantics", () => {
  test("should throw gateRejection when event, dispose, or host events return blocked or failed", async () => {
    const failedEvent = entry({
      path: "/project/.owflow/hooks/event.sh",
      event: "event",
    });
    const blockedDispose = entry({
      path: "/project/.owflow/hooks/dispose.sh",
      event: "dispose",
    });
    const failedHost = entry({
      path: "/project/.owflow/hooks/session-idle.sh",
      event: "session.idle",
    });
    const execution = harness(
      registryOf([failedEvent, blockedDispose, failedHost]),
      [
        { status: "failed", reason: "telemetry exploded" },
        { status: "blocked", reason: "cleanup disallowed" },
        { status: "failed", reason: "idle check failed" },
      ],
    );

    const eventMsg = await rejectionMessage(execution.dispatch, "event", {
      type: "session.idle",
      sessionID: "ses_event",
    });
    expect(eventMsg.startsWith("Blocked:")).toBe(true);
    expect(eventMsg).toContain("telemetry exploded");
    expect(eventMsg).toContain("Hint:");
    expect(execution.endedSessions).toEqual(["ses_event"]);

    const disposeMsg = await rejectionMessage(execution.dispatch, "dispose", {
      reason: "shutdown",
    });
    expect(disposeMsg.startsWith("Blocked:")).toBe(true);
    expect(disposeMsg).toContain("cleanup disallowed");
    expect(disposeMsg).toContain("Hint:");

    const hostMsg = await rejectionMessage(execution.dispatch, "session.idle", {
      event: {
        type: "session.idle",
        properties: { sessionID: "ses_idle" },
      },
    });
    expect(hostMsg.startsWith("Blocked:")).toBe(true);
    expect(hostMsg).toContain("idle check failed");
    expect(hostMsg).toContain("Hint:");
    expect(execution.endedSessions).toEqual(["ses_event", "ses_idle"]);
  });

  test("should resolve cleanly on ok status for event, dispose, and host events", async () => {
    const okExecution = harness(
      registryOf([
        entry({ path: "/project/.owflow/hooks/event.sh", event: "event" }),
        entry({ path: "/project/.owflow/hooks/dispose.sh", event: "dispose" }),
      ]),
      [{ status: "ok" }, { status: "ok" }],
    );

    await expect(
      okExecution.dispatch("event", { type: "session.idle" }),
    ).resolves.toBeUndefined();
    await expect(
      okExecution.dispatch("dispose", { reason: "shutdown" }),
    ).resolves.toBeUndefined();
  });

  test("should treat raw throws from execution as failed gate outcomes", async () => {
    const throwingExecution = harness(
      registryOf([
        entry({ path: "/project/.owflow/hooks/dispose.sh", event: "dispose" }),
      ]),
      [new Error("runner exploded")],
    );

    const msg = await rejectionMessage(throwingExecution.dispatch, "dispose", {
      reason: "shutdown",
    });
    expect(msg.startsWith("Blocked:")).toBe(true);
    expect(msg).toContain("runner exploded");
    expect(msg).toContain("Hint:");
  });
});

describe("host event translation", () => {
  test("should dispatch an event-named hook with the raw host event and nested session ID", async () => {
    const execution = harness(
      registryOf([
        entry({
          path: "/project/.owflow/hooks/session-idle.sh",
          event: "session.idle",
        }),
      ]),
      [{ status: "ok", capture: { stderr: "built\n" } }],
    );

    const input = {
      event: {
        type: "session.idle",
        properties: { sessionID: "ses_idle" },
      },
    };

    await expect(
      execution.dispatch("session.idle", input),
    ).resolves.toBeUndefined();

    expect(execution.calls).toHaveLength(1);
    expect(execution.calls[0]!.envelope).toMatchObject({
      protocol: "owflow-hooks/1",
      event: "session.idle",
      class: "gate",
      session: { sessionID: "ses_idle" },
      context: { event: input.event },
    });
  });

  test("should extract session IDs from message events and end session on failure", async () => {
    const execution = harness(
      registryOf([
        entry({
          path: "/project/.owflow/hooks/message-updated.sh",
          event: "message.updated",
        }),
        entry({
          path: "/project/.owflow/hooks/message-part-updated.sh",
          event: "message.part.updated",
        }),
      ]),
      [
        { status: "failed", reason: "side effect failed" },
        { status: "ok" },
      ],
    );

    const msg = await rejectionMessage(execution.dispatch, "message.updated", {
      event: {
        type: "message.updated",
        properties: { info: { sessionID: "ses_message" } },
      },
    });

    expect(execution.calls[0]!.envelope.session).toEqual({
      sessionID: "ses_message",
    });
    expect(execution.endedSessions).toEqual(["ses_message"]);
    expect(msg.startsWith("Blocked:")).toBe(true);
    expect(msg).toContain("side effect failed");
  });
});

describe("missing interpreter at fire", () => {
  test("should fail closed and end session when any hook interpreter is missing", async () => {
    const gateEntry = entry({
      path: "/project/.owflow/hooks/tool-execute-before.sh",
      interpreter: { expected: "bash", available: false },
      status: "will-fail-closed",
    });
    const configEntry = entry({
      path: "/project/.owflow/hooks/config.sh",
      event: "config",
      interpreter: { expected: "bash", available: false },
      status: "will-fail-closed",
    });
    const eventEntry = entry({
      path: "/project/.owflow/hooks/event.sh",
      event: "event",
      interpreter: { expected: "bash", available: false },
      status: "will-fail-closed",
    });
    const execution = harness(
      registryOf([gateEntry, configEntry, eventEntry]),
      [],
    );

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

    const configMsg = await rejectionMessage(
      execution.dispatch,
      "config",
      {},
    );
    expect(configMsg.startsWith("Blocked:")).toBe(true);
    expect(configMsg).toContain("bash");
    expect(configMsg).toContain("Hint:");

    const eventMsg = await rejectionMessage(
      execution.dispatch,
      "event",
      { sessionID: "ses_event" },
    );
    expect(eventMsg.startsWith("Blocked:")).toBe(true);
    expect(eventMsg).toContain("bash");
    expect(eventMsg).toContain("Hint:");
    expect(execution.endedSessions).toEqual(["ses_missing", "ses_event"]);

    // A script with no interpreter is never handed to the execution core.
    expect(execution.calls).toHaveLength(0);
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

  test("should report a missing interpreter as skipped and fail closed", async () => {
    const reports: HookStatusReport[] = [];
    const missing = entry({
      path: "/project/.owflow/hooks/config.sh",
      event: "config",
      interpreter: { expected: "bash", available: false },
      status: "will-fail-closed",
    });
    const dispatch = createDispatcher({
      run: async () => {
        throw new Error("must not run");
      },
      registry: registryOf([missing]),
      onStatus: (report) => reports.push(report),
    });

    await expect(dispatch("config", {})).rejects.toThrow(
      "cannot run: the bash interpreter is not available",
    );

    expect(reports).toHaveLength(1);
    expect(reports[0]?.phase).toBe("skipped");
    expect(reports[0]?.reason).toContain("bash is not available");
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

describe("runtime log observer", () => {
  test("should emit one settled report with runId, session, timing, and capture", async () => {
    let clock = 100;
    const reports: HookRunLogReport[] = [];
    const logEntry = entry();
    const dispatch = createDispatcher({
      run: async () => {
        clock = 150;
        return {
          status: "ok",
          capture: { stderr: "note\n", exitCode: 0 },
        };
      },
      registry: registryOf([logEntry]),
      now: () => clock,
      onRunLog: (report) => reports.push(report),
    });

    await dispatch(
      "tool.execute.before",
      { tool: "bash", sessionID: "ses_log" },
      { args: {} },
    );

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      entry: logEntry,
      runId: "tool.execute.before#1",
      phase: "settled",
      sessionID: "ses_log",
      startedAt: 100,
      finishedAt: 150,
      capture: { stderr: "note\n", exitCode: 0 },
      outcome: {
        status: "ok",
        capture: { stderr: "note\n", exitCode: 0 },
      },
    });
  });

  test("should emit failure reports with reasons for blocked and failed gates", async () => {
    const reports: HookRunLogReport[] = [];
    const outcomes: Outcome[] = [
      { status: "blocked", reason: "policy says no" },
      { status: "failed", reason: "gate broke" },
    ];
    let index = 0;
    const dispatch = createDispatcher({
      run: async () => outcomes[index++]!,
      registry: registryOf([entry()]),
      onRunLog: (report) => reports.push(report),
    });

    await expect(
      dispatch("tool.execute.before", { tool: "bash" }, { args: {} }),
    ).rejects.toThrow("policy says no");
    await expect(
      dispatch("tool.execute.before", { tool: "bash" }, { args: {} }),
    ).rejects.toThrow("gate broke");

    expect(reports).toHaveLength(2);
    expect(reports[0]).toMatchObject({
      phase: "settled",
      reason: "policy says no",
      outcome: { status: "blocked" },
    });
    expect(reports[1]).toMatchObject({
      phase: "settled",
      reason: "gate broke",
      outcome: { status: "failed" },
    });
  });

  test("should emit a skipped failure report with the interpreter reason", async () => {
    const reports: HookRunLogReport[] = [];
    const missing = entry({
      path: "/project/.owflow/hooks/tool-execute-before.sh",
      interpreter: { expected: "bash", available: false },
      status: "will-fail-closed",
    });
    const dispatch = createDispatcher({
      run: async () => {
        throw new Error("must not run");
      },
      registry: registryOf([missing]),
      now: () => 5_000,
      onRunLog: (report) => reports.push(report),
    });

    await expect(
      dispatch(
        "tool.execute.before",
        { tool: "bash", sessionID: "ses_skip" },
        { args: {} },
      ),
    ).rejects.toThrow("bash");

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      runId: "tool.execute.before#1",
      phase: "skipped",
      reason: "bash is not available",
      sessionID: "ses_skip",
      startedAt: 5_000,
      finishedAt: 5_000,
    });
    expect(reports[0]?.capture).toBeUndefined();
    expect(reports[0]?.outcome).toBeUndefined();
  });

  test("should warn once and preserve gate semantics when the log observer throws", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const statusPhases: string[] = [];
      const ended: string[] = [];
      const dispatch = createDispatcher({
        run: async () => ({ status: "failed", reason: "gate broke" }),
        registry: registryOf([entry()]),
        endSession: (sessionID) => {
          ended.push(sessionID);
        },
        onStatus: (report) => statusPhases.push(report.phase),
        onRunLog: () => {
          throw new Error("log observer exploded");
        },
      });

      await expect(
        dispatch(
          "tool.execute.before",
          { tool: "bash", sessionID: "ses_failed" },
          { args: {} },
        ),
      ).rejects.toThrow("gate broke");
      await expect(
        dispatch(
          "tool.execute.before",
          { tool: "bash", sessionID: "ses_failed" },
          { args: {} },
        ),
      ).rejects.toThrow("gate broke");

      expect(statusPhases).toEqual([
        "pending",
        "settled",
        "pending",
        "settled",
      ]);
      expect(ended).toEqual(["ses_failed", "ses_failed"]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain(
        "log observer exploded",
      );
    } finally {
      warn.mockRestore();
    }
  });
});

describe("silent catch-all event runs", () => {
  const observeEntry = (): HookRegistryEntry =>
    entry({
      path: "/project/.owflow/hooks/event.sh",
      event: "event",
    });

  const observeDispatch = (
    outcome: Outcome,
    onStatus: (report: HookStatusReport) => void,
    onRunLog: (report: HookRunLogReport) => void,
    now: () => number,
  ): Dispatcher =>
    createDispatcher({
      run: async () => outcome,
      registry: registryOf([observeEntry()]),
      now,
      onStatus,
      onRunLog,
    });

  test("should report pending and clear it for a successful catch-all run that captured no output", async () => {
    const statuses: HookStatusReport[] = [];
    const logs: HookRunLogReport[] = [];
    const dispatch = observeDispatch(
      { status: "ok", capture: { exitCode: 0 } },
      (report) => statuses.push(report),
      (report) => logs.push(report),
      () => 1_000,
    );

    await expect(
      dispatch("event", { type: "session.updated" }),
    ).resolves.toBeUndefined();

    expect(statuses).toHaveLength(2);
    expect(statuses[0]).toMatchObject({ phase: "pending", runId: "event#1" });
    expect(statuses[1]).toMatchObject({
      phase: "settled",
      runId: "event#1",
      noop: true,
    });
    expect(statuses[1]?.outcome).toBeUndefined();
    expect(logs).toEqual([]);
  });

  test("should record a silent successful event-named run as a normal outcome", async () => {
    const statuses: HookStatusReport[] = [];
    const logs: HookRunLogReport[] = [];
    const dispatch = createDispatcher({
      run: async () => ({ status: "ok", capture: { exitCode: 0 } }),
      registry: registryOf([
        entry({
          path: "/project/.owflow/hooks/session-idle.sh",
          event: "session.idle",
        }),
      ]),
      now: () => 1_000,
      onStatus: (report) => statuses.push(report),
      onRunLog: (report) => logs.push(report),
    });

    await expect(
      dispatch("session.idle", { event: { type: "session.idle" } }),
    ).resolves.toBeUndefined();

    expect(statuses).toHaveLength(2);
    expect(statuses[0]).toMatchObject({
      phase: "pending",
      runId: "session.idle#1",
    });
    expect(statuses[1]).toMatchObject({
      phase: "settled",
      runId: "session.idle#1",
      outcome: { status: "ok" },
    });
    expect(statuses[1]?.noop).toBeUndefined();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      phase: "settled",
      runId: "session.idle#1",
      outcome: { status: "ok" },
    });
  });

  test("should report an observe run that captured visible output", async () => {
    const statuses: HookStatusReport[] = [];
    const logs: HookRunLogReport[] = [];
    let clock = 1_000;
    const dispatch = observeDispatch(
      { status: "ok", capture: { stdout: "[log] built\n" } },
      (report) => statuses.push(report),
      (report) => logs.push(report),
      () => clock,
    );

    clock = 1_050;
    await dispatch("event", { type: "session.idle" });

    expect(statuses).toHaveLength(2);
    expect(statuses[0]).toMatchObject({ phase: "pending", runId: "event#1" });
    expect(statuses[1]).toMatchObject({
      phase: "settled",
      runId: "event#1",
      outcome: { status: "ok" },
      startedAt: 1_050,
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      phase: "settled",
      runId: "event#1",
      startedAt: 1_050,
      finishedAt: 1_050,
      capture: { stdout: "[log] built\n" },
    });
  });

  test("should still report a silent failure and fail closed", async () => {
    const statuses: HookStatusReport[] = [];
    const logs: HookRunLogReport[] = [];
    const dispatch = observeDispatch(
      { status: "failed", reason: "boom" },
      (report) => statuses.push(report),
      (report) => logs.push(report),
      () => 2_000,
    );

    await expect(
      dispatch("event", { type: "session.idle" }),
    ).rejects.toThrow("boom");

    expect(statuses).toHaveLength(2);
    expect(statuses[0]).toMatchObject({ phase: "pending", runId: "event#1" });
    expect(statuses[1]).toMatchObject({
      phase: "settled",
      outcome: { status: "failed", reason: "boom" },
      reason: "boom",
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.outcome?.status).toBe("failed");
  });
});

describe("mutation whitelist", () => {
  test("should apply whitelisted mutations, warn-and-ignore the rest, and never mutate non-whitelisted outputs", async () => {
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
        path: "/project/.owflow/hooks/chat-message.sh",
        event: "chat.message",
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
        path: "/project/.owflow/hooks/experimental-session-compacting.sh",
        event: "experimental.session.compacting",
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

      // Non-whitelisted events (like config) apply no mutations.
      const configEntry = entry({
        path: "/project/.owflow/hooks/config.sh",
        event: "config",
      });
      const configExecution = harness(
        registryOf([configEntry]),
        [{ status: "ok", mutations: { enabled: false } }],
      );
      const configOutput: Record<string, unknown> = { model: "keep" };
      await configExecution.dispatch("config", {}, configOutput);
      expect(configOutput).toEqual({ model: "keep" });

      // One warning for "command", two rich-object fields, one config mutation.
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
