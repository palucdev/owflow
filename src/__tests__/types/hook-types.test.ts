import { describe, expect, test } from "bun:test";
import {
  DISPATCHABLE_EVENTS,
  EXCLUDED_EVENT_NAMES,
  HOOK_EVENT_NAMES,
  HOST_EVENT_NAMES,
  HookDigestMode,
  HookEvent,
  isHookEventName,
  isHostEventName,
  type HookRegistryEntry,
  type HookReportInput,
  type HookRunLogRecord,
  type HookRuntimeEntry,
  type HookScan,
  type HookStatusSnapshot,
  type HookValidationFailure,
  type HooksWrapper,
  type HooksWrapperOptions,
  type InterpreterResolution,
} from "../../types/hook-types.js";

describe("hook-types", () => {
  test("HookEvent enum defines expected values", () => {
    expect(HookEvent.ToolExecuteBefore).toBe("tool.execute.before");
    expect(HookEvent.ToolExecuteAfter).toBe("tool.execute.after");
    expect(HookEvent.Config).toBe("config");
    expect(HookEvent.Event).toBe("event");
    expect(HookEvent.Dispose).toBe("dispose");
  });

  test("HookDigestMode enum defines FailFast and Report", () => {
    expect(HookDigestMode.FailFast).toBe("fail-fast");
    expect(HookDigestMode.Report).toBe("report");
  });

  test("DISPATCHABLE_EVENTS contains all HookEvent values", () => {
    const expected = Object.values(HookEvent);
    expect(DISPATCHABLE_EVENTS).toEqual(expected);
  });

  test("HOOK_EVENT_NAMES includes dispatchable and host events", () => {
    for (const d of DISPATCHABLE_EVENTS) {
      expect(HOOK_EVENT_NAMES).toContain(d);
    }
    for (const h of HOST_EVENT_NAMES) {
      expect(HOOK_EVENT_NAMES).toContain(h);
    }
  });

  test("isHostEventName type predicate accurately distinguishes host events", () => {
    expect(isHostEventName("session.idle")).toBe(true);
    expect(isHostEventName("tool.execute.before")).toBe(false);
    expect(isHostEventName("not.an.event")).toBe(false);
  });

  test("isHookEventName type predicate identifies dispatchable and host events", () => {
    expect(isHookEventName("tool.execute.before")).toBe(true);
    expect(isHookEventName("session.idle")).toBe(true);
    expect(isHookEventName("invalid.event")).toBe(false);
    for (const excluded of EXCLUDED_EVENT_NAMES) {
      expect(isHookEventName(excluded)).toBe(false);
    }
  });

  test("interfaces can be instantiated with valid typing", () => {
    const interpreter: InterpreterResolution = {
      expected: "bash",
      available: true,
      resolved: "/bin/bash",
    };
    const entry: HookRegistryEntry = {
      path: "/path/to/hook.sh",
      event: HookEvent.ToolExecuteBefore,
      interpreter,
      status: "registered",
    };
    const failure: HookValidationFailure = {
      path: "/bad/hook",
      error: "invalid",
    };
    const scan: HookScan = {
      entries: [entry],
      failures: [failure],
    };
    const reportInput: HookReportInput = {
      entries: scan.entries,
      failures: scan.failures,
      bypassed: false,
    };
    const runtimeEntry: HookRuntimeEntry = {
      status: "success",
      startedAt: 100,
      finishedAt: 150,
      durationMs: 50,
    };
    const snapshot: HookStatusSnapshot = {
      version: 1,
      pid: 1234,
      workspace: "/test",
      updatedAt: 1000,
      hooks: { "tool.execute.before": runtimeEntry },
    };
    const logRecord: HookRunLogRecord = {
      version: 1,
      runId: "run-1",
      pid: 1234,
      workspace: "/test",
      event: HookEvent.ToolExecuteBefore,
      hook: "/path/to/hook.sh",
      name: "hook",
      startedAt: 100,
      finishedAt: 150,
      durationMs: 50,
      status: "success",
    };
    const options: HooksWrapperOptions = {
      statusFile: "/tmp/status.json",
      logFile: "/tmp/log.jsonl",
    };
    const wrapper: HooksWrapper = {
      dispatch: async () => {},
      snapshot: reportInput,
      dispose: () => {},
    };

    expect(entry.event).toBe("tool.execute.before");
    expect(scan.entries).toHaveLength(1);
    expect(reportInput.bypassed).toBe(false);
    expect(snapshot.version).toBe(1);
    expect(logRecord.status).toBe("success");
    expect(options.statusFile).toBe("/tmp/status.json");
    expect(typeof wrapper.dispose).toBe("function");
  });
});
