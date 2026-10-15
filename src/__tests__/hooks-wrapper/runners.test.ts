import { describe, expect, test } from "bun:test";
import { buildEnvelope } from "../../hooks-wrapper/envelope.js";
import {
  createInProcessRunner,
  createSubprocessRunner,
} from "../../hooks-wrapper/runners.js";
import type {
  ModuleImporter,
  SpawnProcess,
  SpawnProcessOptions,
  SpawnedProcess,
} from "../../hooks-wrapper/runners.js";
import type {
  EnvelopeContext,
  HookRegistryEntry,
  Outcome,
} from "../../hooks-wrapper/types.js";

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
  session: { sessionID: "ses_abc" },
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
    expect(index).toBe(2);
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
