import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildEnvelope,
  createExecutionCore,
  createInProcessRunner,
  createSubprocessRunner,
  parseEnvelopeResult,
} from "../../hooks-wrapper/runners.js";
import type {
  HookRunner,
  InProcessRunner,
  ModuleImporter,
  SpawnProcess,
  SpawnProcessOptions,
  SpawnedProcess,
} from "../../hooks-wrapper/runners.js";
import {
  buildRegistry,
  resolveInterpreterAvailability,
} from "../../hooks-wrapper/registry.js";
import type {
  EnvelopeContext,
  HookRegistryEntry,
  HookScript,
  Outcome,
} from "../../hooks-wrapper/registry.js";

describe("buildEnvelope", () => {
  class FakeModel {
    constructor(
      readonly id: string,
      readonly providerID: string,
      readonly name: string,
      readonly apiKey: string,
    ) {}
  }

  class FakeProvider {
    constructor(
      readonly id: string,
      readonly name: string,
      readonly options: Record<string, unknown>,
    ) {}
  }

  class FakePart {
    constructor(
      readonly id: string,
      readonly sessionID: string,
      readonly messageID: string,
      readonly type: string,
      readonly text: string,
    ) {}
  }

  test("should emit the versioned envelope with derived class, session, and a projected context", () => {
    const envelope = buildEnvelope({
      event: "tool.execute.before",
      sessionID: "ses_abc",
      context: {
        tool: "bash",
        args: { command: "rm -rf build" },
        model: new FakeModel(
          "claude-sonnet-4",
          "anthropic",
          "Claude Sonnet 4",
          "sk-secret",
        ),
        provider: new FakeProvider("anthropic", "Anthropic", {
          key: "sk-provider",
        }),
        parts: [new FakePart("prt_1", "ses_abc", "msg_1", "text", "hello")],
        opaque: new (class {
          readonly secret = "hide me";
        })(),
      },
    });

    expect(envelope.protocol).toBe("owflow-hooks/1");
    expect(envelope.event).toBe("tool.execute.before");
    expect(envelope.class).toBe("gate");
    expect(envelope.session).toEqual({ sessionID: "ses_abc" });

    expect(envelope.context).toEqual({
      tool: "bash",
      args: { command: "rm -rf build" },
      model: {
        id: "claude-sonnet-4",
        providerID: "anthropic",
        name: "Claude Sonnet 4",
      },
      provider: { id: "anthropic", name: "Anthropic" },
      parts: [
        {
          id: "prt_1",
          sessionID: "ses_abc",
          messageID: "msg_1",
          type: "text",
        },
      ],
    });

    // Projection must keep non-identity instance fields out of the envelope.
    const serialized = JSON.stringify(envelope);
    expect(serialized).not.toContain("sk-secret");
    expect(serialized).not.toContain("sk-provider");
    expect(serialized).not.toContain("hide me");
    expect(serialized).not.toContain("hello");
    expect(JSON.parse(serialized)).toEqual(envelope);

    const observeEnvelope = buildEnvelope({ event: "config", context: {} });
    expect(observeEnvelope.class).toBe("observe");
    expect(observeEnvelope.session).toBeUndefined();

    const emptySession = buildEnvelope({
      event: "config",
      context: {},
      sessionID: "",
    });
    expect(emptySession.session).toBeUndefined();
  });
});

describe("parseEnvelopeResult", () => {
  test("should parse ok, blocked, and failed results with reason and mutations", () => {
    const ok = parseEnvelopeResult(
      '{"protocol":"owflow-hooks/1","status":"ok","mutations":{"args":{"command":"ls -la"}}}',
    );
    expect(ok).toEqual({
      ok: true,
      data: {
        protocol: "owflow-hooks/1",
        status: "ok",
        mutations: { args: { command: "ls -la" } },
      },
    });

    const blocked = parseEnvelopeResult(
      '{"protocol":"owflow-hooks/1","status":"blocked","reason":"rm -rf is not allowed for this agent"}',
    );
    expect(blocked).toEqual({
      ok: true,
      data: {
        protocol: "owflow-hooks/1",
        status: "blocked",
        reason: "rm -rf is not allowed for this agent",
      },
    });

    const failed = parseEnvelopeResult(
      '{"protocol":"owflow-hooks/1","status":"failed","reason":"missing jq"}',
    );
    expect(failed).toEqual({
      ok: true,
      data: {
        protocol: "owflow-hooks/1",
        status: "failed",
        reason: "missing jq",
      },
    });

    // In-process handlers return the result object instead of stdout JSON.
    expect(
      parseEnvelopeResult({ protocol: "owflow-hooks/1", status: "ok" }),
    ).toEqual({
      ok: true,
      data: { protocol: "owflow-hooks/1", status: "ok" },
    });
  });

  test("should return a parse-error sentinel — never a throw, never a log — for malformed and mismatched results", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    try {
      const throwingGetter = Object.defineProperty({}, "protocol", {
        get() {
          throw new Error("exotic getter");
        },
      });

      const malformed: readonly unknown[] = [
        "not json at all",
        '{"protocol":',
        "",
        "null",
        "[]",
        "42",
        '{"status":"ok"}',
        '{"protocol":null,"status":"ok"}',
        '{"protocol":"owflow-hooks/2","status":"ok"}',
        '{"protocol":"owflow-hooks/1","status":"bogus"}',
        '{"protocol":"owflow-hooks/1","status":"ok","reason":42}',
        '{"protocol":"owflow-hooks/1","status":"ok","mutations":[]}',
        throwingGetter,
        undefined,
      ];

      for (const raw of malformed) {
        const parsed = parseEnvelopeResult(raw);
        expect(parsed.ok).toBe(false);
        expect(typeof parsed.error).toBe("string");
        expect(parsed.error ?? "").not.toBe("");
        expect(parsed.data).toBeUndefined();
      }

      expect(parseEnvelopeResult("not json at all").error ?? "").toContain(
        "unparseable",
      );
      expect(parseEnvelopeResult('{"status":"ok"}').error ?? "").toContain(
        "missing protocol",
      );
      expect(
        parseEnvelopeResult('{"protocol":"owflow-hooks/2","status":"ok"}')
          .error ?? "",
      ).toContain("owflow-hooks/2");

      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

const inProcessEntry = (
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

const subprocessEntry = (
  overrides: Partial<HookRegistryEntry> = {},
): HookRegistryEntry => ({
  path: "/project/.owflow/hooks/tool-execute-before.sh",
  event: "tool.execute.before",
  class: "gate",
  runnerClass: "subprocess",
  interpreter: { resolved: "/usr/bin/bash", available: true },
  status: "registered",
  ...overrides,
});

const envelope = buildEnvelope({
  event: "tool.execute.before",
  sessionID: "ses_abc",
  context: { tool: "bash", args: { command: "rm -rf build" } },
});

const commandEnvelope = (command: string): EnvelopeContext =>
  buildEnvelope({
    event: "tool.execute.before",
    context: { tool: "bash", args: { command } },
  });

const resultJson = (result: Record<string, unknown>): string =>
  JSON.stringify({ protocol: "owflow-hooks/1", ...result });

interface FakeProcessSpec {
  readonly exitCode: number | null;
  readonly signalCode?: string | null;
  readonly stdout?: string;
  readonly stderr?: string;
}

const fakeProcess = ({
  exitCode,
  signalCode = null,
  stdout = "",
  stderr = "",
}: FakeProcessSpec): SpawnedProcess => ({
  exited: Promise.resolve(exitCode),
  exitCode,
  signalCode,
  stdout: { text: async () => stdout },
  stderr: { text: async () => stderr },
});

describe("createInProcessRunner", () => {
  test("should normalize undefined returns to ok, Blocked throws to blocked, and import each module exactly once", async () => {
    let importCalls = 0;
    const importModule: ModuleImporter = async (specifier) => {
      importCalls += 1;
      expect(specifier.startsWith("file://")).toBe(true);
      expect(specifier.endsWith("/tool-execute-before.ts")).toBe(true);
      return {
        default: async (input: EnvelopeContext): Promise<unknown> => {
          const args = input.context.args as { command?: unknown };
          if (args.command === "blocked")
            throw new Error("Blocked: rm -rf is not allowed for this agent");
          if (args.command === "boom") throw new Error("script exploded");
          if (args.command === "malformed") return { not: "a result" };
          if (args.command === "mutate")
            return {
              protocol: "owflow-hooks/1",
              status: "ok",
              mutations: { args: { command: "ls -la" } },
            };
          return undefined;
        },
      };
    };

    const runner = createInProcessRunner(importModule);
    await runner.load(inProcessEntry());

    const ok: Outcome = await runner.run(inProcessEntry(), envelope);
    expect(ok).toEqual({ status: "ok" });

    const blocked = await runner.run(
      inProcessEntry(),
      commandEnvelope("blocked"),
    );
    // The `Blocked:` prefix is stripped so the dispatcher can re-prefix once.
    expect(blocked).toEqual({
      status: "blocked",
      reason: "rm -rf is not allowed for this agent",
    });

    const failed = await runner.run(inProcessEntry(), commandEnvelope("boom"));
    expect(failed).toEqual({ status: "failed", reason: "script exploded" });

    const malformed = await runner.run(
      inProcessEntry(),
      commandEnvelope("malformed"),
    );
    expect(malformed.status).toBe("failed");
    expect(malformed.reason ?? "").toContain("missing protocol");

    const mutated = await runner.run(
      inProcessEntry(),
      commandEnvelope("mutate"),
    );
    expect(mutated).toEqual({
      status: "ok",
      mutations: { args: { command: "ls -la" } },
    });

    expect(importCalls).toBe(1);

    const broken = createInProcessRunner(async () => ({ default: undefined }));
    await expect(broken.load(inProcessEntry())).rejects.toThrow(
      /default-export a handler function/,
    );
    // A broken module degrades to a failed outcome when fired, never a throw.
    const brokenRun = await broken.run(inProcessEntry(), envelope);
    expect(brokenRun.status).toBe("failed");
    expect(brokenRun.reason ?? "").toContain("default-export");
  });
});

describe("createSubprocessRunner", () => {
  test("should map exit codes to outcomes with parsed JSON status taking precedence", async () => {
    const processes: SpawnedProcess[] = [
      fakeProcess({ exitCode: 0 }),
      fakeProcess({
        exitCode: 0,
        stdout: resultJson({ status: "blocked", reason: "policy" }),
      }),
      fakeProcess({ exitCode: 3, stderr: "boom: line 1\n" }),
      fakeProcess({
        exitCode: 1,
        stdout: resultJson({ status: "failed", reason: "missing jq" }),
      }),
      fakeProcess({
        exitCode: 0,
        stdout: resultJson({
          status: "ok",
          mutations: { args: { command: "ls -la" } },
        }),
      }),
      fakeProcess({ exitCode: null, signalCode: "SIGKILL" }),
      {
        exited: Promise.resolve(0),
        exitCode: 0,
        signalCode: null,
        stdout: {
          text: async () => {
            throw new Error("stream read failed");
          },
        },
        stderr: {
          text: async () => {
            throw new Error("stream read failed");
          },
        },
      },
    ];
    let index = 0;
    const spawn: SpawnProcess = () => processes[index++]!;
    const runner = createSubprocessRunner({ cwd: "/project", spawn });

    // Absent stdout on exit 0 has the same meaning as an absent result object.
    expect(await runner.run(subprocessEntry(), envelope)).toEqual({
      status: "ok",
    });

    // A script may exit 0 and still declare a blocking status.
    expect(await runner.run(subprocessEntry(), envelope)).toEqual({
      status: "blocked",
      reason: "policy",
    });

    const exited = await runner.run(subprocessEntry(), envelope);
    expect(exited.status).toBe("failed");
    expect(exited.reason).toContain("boom");

    // A script may exit non-zero and declare its own status; JSON wins.
    expect(await runner.run(subprocessEntry(), envelope)).toEqual({
      status: "failed",
      reason: "missing jq",
    });

    expect(await runner.run(subprocessEntry(), envelope)).toEqual({
      status: "ok",
      mutations: { args: { command: "ls -la" } },
    });

    // `exitCode === null` is never conflated with success.
    const signalled = await runner.run(subprocessEntry(), envelope);
    expect(signalled.status).toBe("failed");
    expect(signalled.reason).toContain("SIGKILL");

    // Unreadable streams degrade to empty output; the exit code still decides.
    expect(await runner.run(subprocessEntry(), envelope)).toEqual({
      status: "ok",
    });
    expect(index).toBe(7);
  });

  test("should fail closed on unparseable stdout even with a zero exit code", async () => {
    const processes: SpawnedProcess[] = [
      fakeProcess({ exitCode: 0, stdout: "not json at all" }),
      fakeProcess({
        exitCode: 0,
        stdout: JSON.stringify({ status: "blocked", reason: "policy" }),
      }),
      fakeProcess({
        exitCode: 7,
        stdout: "not json at all",
        stderr: "script died\n",
      }),
    ];
    let index = 0;
    const spawn: SpawnProcess = () => processes[index++]!;
    const runner = createSubprocessRunner({ cwd: "/project", spawn });

    // Garbage on stdout is a malformed result — a zero exit must not pass a gate.
    const garbage = await runner.run(subprocessEntry(), envelope);
    expect(garbage.status).toBe("failed");
    expect(garbage.reason ?? "").toContain("unparseable JSON");

    // JSON missing the protocol is malformed too, whatever status it claims.
    const missingProtocol = await runner.run(subprocessEntry(), envelope);
    expect(missingProtocol.status).toBe("failed");
    expect(missingProtocol.reason ?? "").toContain("missing protocol");

    // A non-zero exit keeps its stderr diagnostics over the stdout parse error.
    const nonZero = await runner.run(subprocessEntry(), envelope);
    expect(nonZero.status).toBe("failed");
    expect(nonZero.reason).toContain("script died");
    expect(index).toBe(3);
  });

  test("should spawn the resolved interpreter with an argument array, piped stdio, and no timeout or signal options", async () => {
    const calls: Array<{ command: string[]; options: SpawnProcessOptions }> =
      [];
    const spawn: SpawnProcess = (command, options) => {
      calls.push({ command, options });
      return fakeProcess({ exitCode: 0 });
    };
    const runner = createSubprocessRunner({ cwd: "/project/root", spawn });

    await runner.run(subprocessEntry(), envelope);

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.command).toEqual([
      "/usr/bin/bash",
      "/project/.owflow/hooks/tool-execute-before.sh",
    ]);
    expect(call.options.cwd).toBe("/project/root");
    expect(call.options.stdout).toBe("pipe");
    expect(call.options.stderr).toBe("pipe");
    // The options object is the no-timeout invariant: only these four keys.
    expect(Object.keys(call.options).sort()).toEqual([
      "cwd",
      "stderr",
      "stdin",
      "stdout",
    ]);
    expect(JSON.parse(new TextDecoder().decode(call.options.stdin))).toEqual(
      envelope,
    );

    // An unavailable interpreter is a defensive failure, never a spawn.
    const missing = await runner.run(
      subprocessEntry({
        interpreter: { expected: "bash", available: false },
        status: "will-fail-closed",
      }),
      envelope,
    );
    expect(missing.status).toBe("failed");
    expect(missing.reason).toContain("no interpreter resolved");
    expect(calls).toHaveLength(1);
  });
});

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

const coreEnvelope = buildEnvelope({
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

    const outcome = await core.run(tsEntry, coreEnvelope);
    expect(outcome).toEqual({
      status: "ok",
      mutations: { args: { command: "ls -la" } },
    });
    expect(inProcessRuns).toEqual([{ entry: tsEntry, envelope: coreEnvelope }]);
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

    const outcome: Outcome = await core.run(shEntry, coreEnvelope);
    expect(outcome).toEqual({ status: "blocked", reason: "policy" });
    expect(subprocessRuns).toEqual([{ entry: shEntry, envelope: coreEnvelope }]);
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
