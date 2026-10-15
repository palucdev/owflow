import { describe, expect, spyOn, test } from "bun:test";
import {
  buildEnvelope,
  parseEnvelopeResult,
} from "../../hooks-wrapper/envelope.js";

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

describe("buildEnvelope", () => {
  test("should emit the versioned envelope with derived class, session, and a projected context", () => {
    const envelope = buildEnvelope({
      event: "tool.execute.before",
      session: { sessionID: "ses_abc" },
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
      session: { sessionID: "" },
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
