import { describe, expect, spyOn, test } from "bun:test";
import {
  buildEnvelope,
  createSubprocessRunner,
  parseEnvelopeResult,
} from "../../hooks-wrapper/runners.js";
import { MAX_CAPTURE_BYTES } from "../../hooks-wrapper/hook-logs.js";
import type {
  SpawnProcess,
  SpawnProcessOptions,
  SpawnedProcess,
} from "../../hooks-wrapper/runners.js";
import type { HookRegistryEntry } from "../../hooks-wrapper/registry.js";

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

    const configEnvelope = buildEnvelope({ event: "config", context: {} });
    expect(configEnvelope.class).toBe("gate");
    expect(configEnvelope.session).toBeUndefined();

    const hostEventEnvelope = buildEnvelope({
      event: "session.idle",
      context: {},
    });
    expect(hostEventEnvelope.event).toBe("session.idle");
    expect(hostEventEnvelope.class).toBe("gate");

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

const subprocessEntry = (
  overrides: Partial<HookRegistryEntry> = {},
): HookRegistryEntry => ({
  path: "/project/.owflow/hooks/tool-execute-before.sh",
  event: "tool.execute.before",
  interpreter: { resolved: "/usr/bin/bash", available: true },
  status: "registered",
  ...overrides,
});

const envelope = buildEnvelope({
  event: "tool.execute.before",
  sessionID: "ses_abc",
  context: { tool: "bash", args: { command: "rm -rf build" } },
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
      capture: { exitCode: 0 },
    });

    // A script may exit 0 and still declare a blocking status.
    expect(await runner.run(subprocessEntry(), envelope)).toEqual({
      status: "blocked",
      reason: "policy",
      capture: { exitCode: 0 },
    });

    const exited = await runner.run(subprocessEntry(), envelope);
    expect(exited.status).toBe("failed");
    expect(exited.reason).toContain("boom");
    expect(exited.capture).toEqual({ stderr: "boom: line 1\n", exitCode: 3 });

    // A script may exit non-zero and declare its own status; JSON wins.
    expect(await runner.run(subprocessEntry(), envelope)).toEqual({
      status: "failed",
      reason: "missing jq",
      capture: { exitCode: 1 },
    });

    expect(await runner.run(subprocessEntry(), envelope)).toEqual({
      status: "ok",
      mutations: { args: { command: "ls -la" } },
      capture: { exitCode: 0 },
    });

    // `exitCode === null` is never conflated with success.
    const signalled = await runner.run(subprocessEntry(), envelope);
    expect(signalled.status).toBe("failed");
    expect(signalled.reason).toContain("SIGKILL");
    expect(signalled.capture).toEqual({
      exitCode: null,
      signal: "SIGKILL",
    });

    // Unreadable streams degrade to empty output; the exit code still decides.
    expect(await runner.run(subprocessEntry(), envelope)).toEqual({
      status: "ok",
      capture: { exitCode: 0 },
    });
    expect(index).toBe(7);
  });

  test("should capture successful stderr and cap chunked streams", async () => {
    const note = fakeProcess({ exitCode: 0, stderr: "note\n" });
    const readerProcess = (chunks: readonly string[]): SpawnedProcess => {
      let index = 0;
      return {
        exited: Promise.resolve(0),
        exitCode: 0,
        signalCode: null,
        stdout: { text: async () => "" },
        stderr: {
          text: async () => "",
          getReader: () => ({
            read: async () =>
              index < chunks.length
                ? {
                    done: false,
                    value: new TextEncoder().encode(chunks[index++]!),
                  }
                : { done: true },
            cancel: () => {},
          }),
        },
      };
    };
    const processes: SpawnedProcess[] = [
      note,
      readerProcess([
        "a".repeat(10 * 1024),
        "b".repeat(10 * 1024),
        "c".repeat(10 * 1024),
      ]),
    ];
    let index = 0;
    const runner = createSubprocessRunner({
      cwd: "/project",
      spawn: () => processes[index++]!,
    });

    const successful = await runner.run(subprocessEntry(), envelope);
    expect(successful).toEqual({
      status: "ok",
      capture: { stderr: "note\n", exitCode: 0 },
    });

    const capped = await runner.run(subprocessEntry(), envelope);
    expect(capped.status).toBe("ok");
    expect(Buffer.byteLength(capped.capture?.stderr ?? "", "utf8")).toBeLessThanOrEqual(
      16 * 1024,
    );
    expect(capped.capture?.truncated).toBe(true);
  });

  test("should capture stdout logs and parse a trailing result envelope", async () => {
    const stdout = [
      "building project...",
      "warning: slow step",
      resultJson({ status: "blocked", reason: "policy" }),
      "",
    ].join("\n");
    const proc = fakeProcess({
      exitCode: 0,
      stdout,
      stderr: "note\n",
    });
    const runner = createSubprocessRunner({
      cwd: "/project",
      spawn: () => proc,
    });

    expect(await runner.run(subprocessEntry(), envelope)).toEqual({
      status: "blocked",
      reason: "policy",
      capture: {
        stdout: "building project...\nwarning: slow step\n",
        stderr: "note\n",
        exitCode: 0,
      },
    });
  });

  test("should read stdout chunks and keep the result envelope out of the capture", async () => {
    const chunks = [
      "first line\n",
      "second line\n",
      `${resultJson({ status: "ok" })}\n`,
    ];
    let chunkIndex = 0;
    const proc: SpawnedProcess = {
      exited: Promise.resolve(0),
      exitCode: 0,
      signalCode: null,
      stdout: {
        text: async () => "",
        getReader: () => ({
          read: async () =>
            chunkIndex < chunks.length
              ? {
                  done: false,
                  value: new TextEncoder().encode(chunks[chunkIndex++]!),
                }
              : { done: true },
        }),
      },
      stderr: { text: async () => "" },
    };
    const runner = createSubprocessRunner({
      cwd: "/project",
      spawn: () => proc,
    });

    expect(await runner.run(subprocessEntry(), envelope)).toEqual({
      status: "ok",
      capture: {
        stdout: "first line\nsecond line\n",
        exitCode: 0,
      },
    });
  });

  test("should keep hook output out of the host console", async () => {
    const spies = [
      spyOn(console, "log").mockImplementation(() => {}),
      spyOn(console, "info").mockImplementation(() => {}),
      spyOn(console, "debug").mockImplementation(() => {}),
      spyOn(console, "warn").mockImplementation(() => {}),
      spyOn(console, "error").mockImplementation(() => {}),
    ];
    try {
      const runner = createSubprocessRunner({
        cwd: "/project",
        spawn: () =>
          fakeProcess({
            exitCode: 0,
            stdout: "visible stdout\n",
            stderr: "visible stderr\n",
          }),
      });

      const outcome = await runner.run(subprocessEntry(), envelope);
      expect(outcome.capture).toEqual({
        stdout: "visible stdout\n",
        stderr: "visible stderr\n",
        exitCode: 0,
      });
      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled();
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  test("should capture plain stdout and fall back to the exit code without a result", async () => {
    const processes: SpawnedProcess[] = [
      fakeProcess({
        exitCode: 0,
        stdout: "building project...\n",
        stderr: "note\n",
      }),
      fakeProcess({
        exitCode: 2,
        stdout: "building project...\n",
        stderr: "compile failed\n",
      }),
    ];
    let index = 0;
    const spawn: SpawnProcess = () => processes[index++]!;
    const runner = createSubprocessRunner({ cwd: "/project", spawn });

    expect(await runner.run(subprocessEntry(), envelope)).toEqual({
      status: "ok",
      capture: {
        stdout: "building project...\n",
        stderr: "note\n",
        exitCode: 0,
      },
    });

    expect(await runner.run(subprocessEntry(), envelope)).toEqual({
      status: "failed",
      reason: "compile failed",
      capture: {
        stdout: "building project...\n",
        stderr: "compile failed\n",
        exitCode: 2,
      },
    });
  });

  test("should find a trailing result envelope when stdout exceeds the capture cap", async () => {
    const logs = `${"x".repeat(MAX_CAPTURE_BYTES + 100)}\n`;
    const proc = fakeProcess({
      exitCode: 0,
      stdout: `${logs}${resultJson({ status: "failed", reason: "boom" })}\n`,
    });
    const runner = createSubprocessRunner({
      cwd: "/project",
      spawn: () => proc,
    });

    const outcome = await runner.run(subprocessEntry(), envelope);
    expect(outcome.status).toBe("failed");
    expect(outcome.reason).toBe("boom");
    expect(outcome.capture?.stdout).toBe(
      "x".repeat(MAX_CAPTURE_BYTES),
    );
    expect(outcome.capture?.truncated).toBe(true);
  });

  test("should scan the stdout tail for a result after the capture cap", async () => {
    const chunks = [
      "y".repeat(MAX_CAPTURE_BYTES),
      "z".repeat(1_000),
      "\n",
      `${resultJson({ status: "ok" })}\n`,
    ];
    let chunkIndex = 0;
    const proc: SpawnedProcess = {
      exited: Promise.resolve(0),
      exitCode: 0,
      signalCode: null,
      stdout: {
        text: async () => "",
        getReader: () => ({
          read: async () =>
            chunkIndex < chunks.length
              ? {
                  done: false,
                  value: new TextEncoder().encode(chunks[chunkIndex++]!),
                }
              : { done: true },
        }),
      },
      stderr: { text: async () => "" },
    };
    const runner = createSubprocessRunner({
      cwd: "/project",
      spawn: () => proc,
    });

    const outcome = await runner.run(subprocessEntry(), envelope);
    expect(outcome.status).toBe("ok");
    expect(outcome.capture?.stdout).toBe("y".repeat(MAX_CAPTURE_BYTES));
    expect(outcome.capture?.truncated).toBe(true);
  });

  test("should fail closed on malformed result-looking stdout even with a zero exit code", async () => {
    const processes: SpawnedProcess[] = [
      fakeProcess({
        exitCode: 0,
        stdout: JSON.stringify({ status: "blocked", reason: "policy" }),
      }),
      fakeProcess({
        exitCode: 0,
        stdout: '{"protocol":',
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

    // JSON missing the protocol is malformed, whatever status it claims.
    const missingProtocol = await runner.run(subprocessEntry(), envelope);
    expect(missingProtocol.status).toBe("failed");
    expect(missingProtocol.reason ?? "").toContain("missing protocol");
    expect(missingProtocol.capture?.stdout).toContain("blocked");

    // A truncated result line is a malformed result, not plain log output.
    const truncatedResult = await runner.run(subprocessEntry(), envelope);
    expect(truncatedResult.status).toBe("failed");
    expect(truncatedResult.reason ?? "").toContain("unparseable JSON");
    expect(truncatedResult.capture?.stdout).toContain('"protocol"');

    // A non-zero exit keeps its stderr diagnostics over any stdout parse issue.
    const nonZero = await runner.run(subprocessEntry(), envelope);
    expect(nonZero.status).toBe("failed");
    expect(nonZero.reason).toContain("script died");
    expect(nonZero.capture).toEqual({
      stdout: "not json at all",
      stderr: "script died\n",
      exitCode: 7,
    });
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
    expect(missing.capture).toEqual({});
    expect(calls).toHaveLength(1);
  });

  test("should kill a hung subprocess when timeoutMs or OWFLOW_HOOK_TIMEOUT_MS expires", async () => {
    let killed = 0;
    const hungProcess: SpawnedProcess = {
      exited: new Promise<number | null>(() => {}),
      exitCode: null,
      signalCode: null,
      stdout: { text: async () => new Promise<string>(() => {}) },
      stderr: { text: async () => new Promise<string>(() => {}) },
      kill: () => {
        killed += 1;
      },
    };
    const runner = createSubprocessRunner({
      cwd: "/project",
      spawn: () => hungProcess,
      timeoutMs: 25,
    });

    const outcome = await runner.run(subprocessEntry(), envelope);
    expect(killed).toBe(1);
    expect(outcome.status).toBe("failed");
    expect(outcome.reason).toBe("process timed out after 25ms");

    const previous = process.env.OWFLOW_HOOK_TIMEOUT_MS;
    process.env.OWFLOW_HOOK_TIMEOUT_MS = "20";
    try {
      const envRunner = createSubprocessRunner({
        cwd: "/project",
        spawn: () => hungProcess,
      });
      const envOutcome = await envRunner.run(subprocessEntry(), envelope);
      expect(killed).toBe(2);
      expect(envOutcome.status).toBe("failed");
      expect(envOutcome.reason).toBe("process timed out after 20ms");
    } finally {
      if (previous === undefined) delete process.env.OWFLOW_HOOK_TIMEOUT_MS;
      else process.env.OWFLOW_HOOK_TIMEOUT_MS = previous;
    }
  });

  test("should track in-flight subprocesses and kill them on dispose()", async () => {
    const killedSignals: Array<number | NodeJS.Signals | undefined> = [];
    let resolveExit!: (code: number | null) => void;
    const inFlight: SpawnedProcess = {
      exited: new Promise<number | null>((resolve) => {
        resolveExit = resolve;
      }),
      exitCode: null,
      signalCode: "SIGTERM",
      stdout: { text: async () => "" },
      stderr: { text: async () => "" },
      kill: (signal) => {
        killedSignals.push(signal);
        resolveExit(null);
      },
    };

    const runner = createSubprocessRunner({
      cwd: "/project",
      spawn: () => inFlight,
    });

    const pendingRun = runner.run(subprocessEntry(), envelope);
    runner.dispose?.();
    const outcome = await pendingRun;

    expect(killedSignals).toHaveLength(1);
    expect(outcome.status).toBe("failed");

    // Subsequent dispose after process settled should not kill again
    runner.dispose?.();
    expect(killedSignals).toHaveLength(1);
  });
});
