import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildEnvelope } from "../../hooks-wrapper/envelope.js";
import { createExecutionCore } from "../../hooks-wrapper/execution-core.js";
import { resolveInterpreterAvailability } from "../../hooks-wrapper/interpreters.js";
import { buildRegistry } from "../../hooks-wrapper/registry.js";
import type { HookRunner, InProcessRunner } from "../../hooks-wrapper/runners.js";
import type {
  EnvelopeContext,
  HookRegistryEntry,
  HookScript,
  Outcome,
} from "../../hooks-wrapper/types.js";

const entryFor = (
  runnerClass: HookRegistryEntry["runnerClass"],
  path: string,
): HookRegistryEntry => ({
  path,
  event: "tool.execute.before",
  class: "gate",
  runnerClass,
  interpreter:
    runnerClass === "in-process"
      ? { available: true }
      : { resolved: "/usr/bin/bash", available: true },
  status: "registered",
});

const envelope = buildEnvelope({
  event: "tool.execute.before",
  context: { tool: "bash", args: { command: "rm -rf build" } },
});

const OUTCOME_KEYS = ["mutations", "reason", "status"];

describe("createExecutionCore", () => {
  test("should load only in-process entries and delegate an in-process run to the in-process runner", async () => {
    const tsEntry = entryFor("in-process", "/project/hooks/a.ts");
    const shEntry = entryFor("subprocess", "/project/hooks/a.sh");
    const loaded: HookRegistryEntry[] = [];
    const inProcessRuns: Array<{ entry: HookRegistryEntry; envelope: EnvelopeContext }> =
      [];
    const subprocessRuns: HookRegistryEntry[] = [];

    const inProcess: InProcessRunner = {
      load: async (entry) => {
        loaded.push(entry);
      },
      run: async (entry, input) => {
        inProcessRuns.push({ entry, envelope: input });
        return { status: "ok", mutations: { args: { command: "ls -la" } } };
      },
    };
    const subprocess: HookRunner = {
      run: async (entry) => {
        subprocessRuns.push(entry);
        return { status: "failed", reason: "subprocess unsupported" };
      },
    };

    const core = createExecutionCore({
      cwd: "/project",
      inProcess,
      subprocess,
    });

    expect(core.run.length).toBe(2);

    await core.load([tsEntry, shEntry]);
    expect(loaded).toEqual([tsEntry]);

    const outcome = await core.run(tsEntry, envelope);
    expect(outcome).toEqual({
      status: "ok",
      mutations: { args: { command: "ls -la" } },
    });
    expect(inProcessRuns).toEqual([{ entry: tsEntry, envelope }]);
    expect(subprocessRuns).toHaveLength(0);
    expect(Object.keys(outcome).every((key) => OUTCOME_KEYS.includes(key))).toBe(
      true,
    );
  });

  test("should delegate a subprocess run to the subprocess runner and never touch the in-process runner", async () => {
    const tsEntry = entryFor("in-process", "/project/hooks/a.ts");
    const shEntry = entryFor("subprocess", "/project/hooks/a.sh");
    const inProcessRuns: HookRegistryEntry[] = [];
    const subprocessRuns: Array<{ entry: HookRegistryEntry; envelope: EnvelopeContext }> =
      [];

    const inProcess: InProcessRunner = {
      load: async () => {},
      run: async (entry) => {
        inProcessRuns.push(entry);
        return { status: "ok" };
      },
    };
    const subprocess: HookRunner = {
      run: async (entry, input) => {
        subprocessRuns.push({ entry, envelope: input });
        return { status: "blocked", reason: "policy" };
      },
    };

    const core = createExecutionCore({
      cwd: "/project",
      inProcess,
      subprocess,
    });

    const outcome: Outcome = await core.run(shEntry, envelope);
    expect(outcome).toEqual({ status: "blocked", reason: "policy" });
    expect(subprocessRuns).toEqual([{ entry: shEntry, envelope }]);
    expect(inProcessRuns).toHaveLength(0);
    expect(tsEntry.runnerClass).toBe("in-process");
    expect(Object.keys(outcome).every((key) => OUTCOME_KEYS.includes(key))).toBe(
      true,
    );
  });
});

describe("createExecutionCore with real runners", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "owflow-hooks-real-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  const realEntry = (
    fileName: string,
    extension: ".ts" | ".sh",
  ): HookRegistryEntry => {
    const script: HookScript = {
      path: path.join(tempDir, fileName),
      stem: "tool-execute-before",
      event: "tool.execute.before",
      class: "gate",
      runnerClass: extension === ".ts" ? "in-process" : "subprocess",
      extension,
    };
    return buildRegistry([script], resolveInterpreterAvailability()).entries[0]!;
  };

  test("should import, load, and run a real in-process .ts hook", async () => {
    fs.writeFileSync(
      path.join(tempDir, "tool-execute-before.ts"),
      'export default async () => ({\n  protocol: "owflow-hooks/1",\n  status: "ok",\n  mutations: { args: { command: "ls -la" } },\n});\n',
      "utf8",
    );
    const entry = realEntry("tool-execute-before.ts", ".ts");
    const core = createExecutionCore({ cwd: tempDir });

    await core.load([entry]);
    const outcome = await core.run(entry, envelope);

    expect(outcome).toEqual({
      status: "ok",
      mutations: { args: { command: "ls -la" } },
    });
  });

  test.skipIf(Bun.which("bash") === null)(
    "should spawn a real bash hook and trust its stdout status over the exit code",
    async () => {
      fs.writeFileSync(
        path.join(tempDir, "tool-execute-before.sh"),
        '#!/bin/bash\nread -r _envelope\nprintf \'%s\' \'{"protocol":"owflow-hooks/1","status":"blocked","reason":"nope"}\'\nexit 1\n',
        "utf8",
      );
      const entry = realEntry("tool-execute-before.sh", ".sh");
      const core = createExecutionCore({ cwd: tempDir });

      const outcome = await core.run(entry, envelope);

      expect(outcome).toEqual({ status: "blocked", reason: "nope" });
    },
  );
});
