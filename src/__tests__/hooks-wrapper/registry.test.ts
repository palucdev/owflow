import {
  afterEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DISPATCHABLE_EVENT_NAMES,
  DISPATCHABLE_EVENTS,
  EXCLUDED_EVENT_NAMES,
  HOOK_EVENT_NAMES,
  HOST_EVENT_NAMES,
  HookDigestMode,
  buildRegistry,
  deriveHook,
  digest,
  isHookExtension,
  resolveInterpreterAvailability,
  scanHooks,
  toDottedEvent,
} from "../../hooks-wrapper/registry.js";
import type {
  EnvelopeContext,
  HookRegistryEntry,
  HookScript,
  InterpreterAvailability,
  Outcome,
} from "../../hooks-wrapper/registry.js";

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
      path: "/p/tool-execute-before.sh",
      stem: "tool-execute-before",
      event: "tool.execute.before",
      class: "gate",
      extension: ".sh",
    } satisfies HookScript;
    const entry = {
      path: script.path,
      event: script.event,
      class: script.class,
      interpreter: { available: true },
      status: "registered",
    } satisfies HookRegistryEntry;

    expect([outcome.status, envelope.protocol, entry.status, script.extension])
      .toEqual(["blocked", "owflow-hooks/1", "registered", ".sh"]);
  });
});

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
  test("should accept only the subprocess extensions", () => {
    expect(isHookExtension(".sh")).toBe(true);
    expect(isHookExtension(".ps1")).toBe(true);
    expect(isHookExtension(".ts")).toBe(false);
    expect(isHookExtension(".js")).toBe(false);
    expect(isHookExtension(".md")).toBe(false);
    expect(isHookExtension("sh")).toBe(false);
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

  test("should classify v1 host events as observe-only event-named hooks", () => {
    expect(new Set(HOOK_EVENT_NAMES)).toEqual(
      new Set([...DISPATCHABLE_EVENT_NAMES, ...HOST_EVENT_NAMES]),
    );
    expect(HOST_EVENT_NAMES).toHaveLength(32);

    expect(deriveHook("session-idle")).toEqual({
      kind: "host-event",
      event: "session.idle",
      class: "observe",
    });
    expect(deriveHook("message-part-updated")).toEqual({
      kind: "host-event",
      event: "message.part.updated",
      class: "observe",
    });
    expect(deriveHook("session-next-step-ended")).toEqual({
      kind: "unknown",
      event: "session.next.step.ended",
    });
  });
});

describe("interpreter resolution", () => {
  test("should resolve bash for .sh and pwsh for .ps1 through the real Bun.which default", () => {
    const paths: Record<string, string | null> = {
      bash: "/usr/bin/bash",
      pwsh: "/usr/bin/pwsh",
    };
    const whichSpy = spyOn(Bun, "which").mockImplementation(
      (command: string) => paths[command] ?? null,
    );

    try {
      const availability = resolveInterpreterAvailability();

      expect(availability[".sh"]).toEqual({
        resolved: "/usr/bin/bash",
        available: true,
      });
      expect(availability[".ps1"]).toEqual({
        resolved: "/usr/bin/pwsh",
        available: true,
      });

      // A pwsh hit means the Windows fallback candidate is never probed.
      expect(whichSpy).toHaveBeenCalledTimes(2);
      expect(whichSpy).toHaveBeenCalledWith("bash");
      expect(whichSpy).toHaveBeenCalledWith("pwsh");
      expect(whichSpy).not.toHaveBeenCalledWith("powershell.exe");
    } finally {
      whichSpy.mockRestore();
    }
  });

  test("should fall back to powershell.exe and record an unresolved interpreter as unavailable without throwing", () => {
    const which = (command: string): string | null =>
      command === "powershell.exe"
        ? "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
        : null;

    const availability = resolveInterpreterAvailability(which);

    expect(availability[".ps1"]).toEqual({
      resolved: "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
      available: true,
    });
    expect(availability[".sh"]).toEqual({
      expected: "bash",
      available: false,
    });
  });
});

describe("digest", () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir !== undefined) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  const makeHooksDir = (): string => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "owflow-hooks-test-"));
    const hooksDir = path.join(tempDir, ".owflow", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    return hooksDir;
  };

  test("should return an empty digest without throwing when the hooks directory is absent or empty", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "owflow-hooks-test-"));
    const hooksDir = path.join(tempDir, ".owflow", "hooks");

    expect(digest(hooksDir, HookDigestMode.FailFast)).toEqual({ entries: [], failures: [] });

    fs.mkdirSync(hooksDir, { recursive: true });
    expect(digest(hooksDir, HookDigestMode.FailFast)).toEqual({ entries: [], failures: [] });
    expect(digest(hooksDir, HookDigestMode.Report)).toEqual({ entries: [], failures: [] });
  });

  test("should fail fast on every invalid entry and collect all violations without throwing in report mode", () => {
    const hooksDir = makeHooksDir();

    fs.writeFileSync(path.join(hooksDir, "tool-execute-before.sh"), "");
    fs.writeFileSync(path.join(hooksDir, "tool-execute-befor.sh"), "");
    fs.writeFileSync(path.join(hooksDir, "permission-ask.sh"), "");
    fs.writeFileSync(path.join(hooksDir, "bad_stem.sh"), "");
    fs.writeFileSync(path.join(hooksDir, "readme.md"), "");
    fs.mkdirSync(path.join(hooksDir, "notes"));

    const failurePaths = [
      path.join(hooksDir, "bad_stem.sh"),
      path.join(hooksDir, "notes"),
      path.join(hooksDir, "permission-ask.sh"),
      path.join(hooksDir, "readme.md"),
      path.join(hooksDir, "tool-execute-befor.sh"),
    ];

    expect(() => digest(hooksDir, HookDigestMode.FailFast)).toThrow();
    try {
      digest(hooksDir, HookDigestMode.FailFast);
      throw new Error("expected the digest to fail fast");
    } catch (error) {
      const message = (error as Error).message;
      expect(message.startsWith("[owflow]")).toBe(true);
      expect(message).toContain("Hint:");
      expect(message).toContain("restart");
      expect(message).toContain("OWFLOW_HOOKS_DISABLED=1");
      for (const failurePath of failurePaths) {
        expect(message).toContain(failurePath);
      }
    }

    const report = digest(hooksDir, HookDigestMode.Report);
    expect(report.failures.map((failure) => failure.path)).toEqual(failurePaths);
    for (const failure of report.failures) {
      expect(failure.error.length).toBeGreaterThan(0);
    }

    const errorFor = (name: string): string =>
      report.failures.find((failure) => failure.path.endsWith(name))!.error;
    expect(errorFor("bad_stem.sh")).toContain("kebab-case");
    expect(errorFor("notes")).toContain("regular file");
    expect(errorFor("permission-ask.sh")).toContain("excluded");
    expect(errorFor("readme.md")).toContain("routable");
    expect(errorFor("tool-execute-befor.sh")).toContain(
      "not a dispatchable hook or a known host event",
    );
    expect(errorFor("tool-execute-befor.sh")).toContain("tool.execute.befor");

    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]!.path).toBe(
      path.join(hooksDir, "tool-execute-before.sh"),
    );
    expect(report.entries[0]!.event).toBe("tool.execute.before");
    expect(report.entries[0]!.class).toBe("gate");
  });

  test("should accept an event-named hook and expose its observe class", () => {
    const hooksDir = makeHooksDir();
    const idlePath = path.join(hooksDir, "session-idle.sh");
    fs.writeFileSync(idlePath, "");

    const report = digest(hooksDir, HookDigestMode.Report);
    expect(report.failures).toEqual([]);
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]).toMatchObject({
      path: idlePath,
      stem: "session-idle",
      event: "session.idle",
      class: "observe",
      extension: ".sh",
    });
  });

  test("should reject legacy .ts and .js hooks as unroutable with the recovery hint", () => {
    const hooksDir = makeHooksDir();
    const tsPath = path.join(hooksDir, "tool-execute-before.ts");
    const jsPath = path.join(hooksDir, "config.js");
    fs.writeFileSync(tsPath, "");
    fs.writeFileSync(jsPath, "");

    const report = digest(hooksDir, HookDigestMode.Report);
    expect(report.entries).toEqual([]);
    expect(report.failures.map((failure) => failure.path)).toEqual([
      jsPath,
      tsPath,
    ]);
    for (const failure of report.failures) {
      expect(failure.error).toContain(
        "is not routable (expected .sh or .ps1)",
      );
    }

    expect(() => digest(hooksDir, HookDigestMode.FailFast)).toThrow(
      /is not routable \(expected \.sh or \.ps1\)/,
    );
    try {
      digest(hooksDir, HookDigestMode.FailFast);
      throw new Error("expected the digest to fail fast");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("Hint:");
      expect(message).toContain("restart");
      expect(message).toContain("OWFLOW_HOOKS_DISABLED=1");
      expect(message).toContain(jsPath);
      expect(message).toContain(tsPath);
    }
  });
});

const script = (overrides: Partial<HookScript>): HookScript => ({
  path: "/hooks/tool-execute-before.sh",
  stem: "tool-execute-before",
  event: "tool.execute.before",
  class: "gate",
  extension: ".sh",
  ...overrides,
});

const AVAILABLE: InterpreterAvailability = {
  ".sh": { resolved: "bash", available: true },
  ".ps1": { resolved: "pwsh", available: true },
};

const UNAVAILABLE_SUBPROCESS: InterpreterAvailability = {
  ".sh": { expected: "bash", available: false },
  ".ps1": { expected: "pwsh", available: false },
};

describe("digest duplicate hook names", () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir !== undefined) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  test("should reject the same hook name in more than one format", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "owflow-hooks-test-"));
    const hooksDir = path.join(tempDir, ".owflow", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, "tool-execute-before.sh"), "");
    fs.writeFileSync(path.join(hooksDir, "tool-execute-before.ps1"), "");

    const report = digest(hooksDir, HookDigestMode.Report);
    expect(report.entries).toEqual([]);
    expect(report.failures.map((failure) => failure.path)).toEqual([
      path.join(hooksDir, "tool-execute-before.ps1"),
      path.join(hooksDir, "tool-execute-before.sh"),
    ]);
    for (const failure of report.failures) {
      expect(failure.error).toContain('hook name "tool-execute-before"');
      expect(failure.error).toContain("exactly one format");
    }

    expect(() => digest(hooksDir, HookDigestMode.FailFast)).toThrow(
      /exactly one format/,
    );
  });

  test("should allow different hook names to use different formats", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "owflow-hooks-test-"));
    const hooksDir = path.join(tempDir, ".owflow", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, "tool-execute-before.sh"), "");
    fs.writeFileSync(path.join(hooksDir, "config.ps1"), "");

    const report = digest(hooksDir, HookDigestMode.Report);
    expect(report.failures).toEqual([]);
    expect(
      report.entries.map((entry) => path.basename(entry.path)).sort(),
    ).toEqual(["config.ps1", "tool-execute-before.sh"]);
  });
});

describe("buildRegistry", () => {
  test("should order entries by event", () => {
    const registry = buildRegistry(
      [
        script({
          path: "/hooks/tool-execute-before.sh",
          stem: "tool-execute-before",
          extension: ".sh",
        }),
        script({
          path: "/hooks/config.ps1",
          stem: "config",
          event: "config",
          class: "observe",
          extension: ".ps1",
        }),
        script({
          path: "/hooks/chat-message.sh",
          stem: "chat-message",
          event: "chat.message",
          extension: ".sh",
        }),
      ],
      AVAILABLE,
    );

    expect(registry.entries.map((entry) => path.basename(entry.path))).toEqual([
      "chat-message.sh",
      "config.ps1",
      "tool-execute-before.sh",
    ]);

    expect(
      registry.byEvent["tool.execute.before"].map((entry) =>
        path.basename(entry.path),
      ),
    ).toEqual(["tool-execute-before.sh"]);
    expect(registry.byEvent["config"]).toHaveLength(1);
    expect(registry.byEvent["dispose"]).toHaveLength(0);
  });

  test("should mark an unavailable interpreter as will-fail-closed on gate events and skipped-no-interpreter on observe events", () => {
    const registry = buildRegistry(
      [
        script({
          path: "/hooks/tool-execute-before.ps1",
          stem: "tool-execute-before",
          extension: ".ps1",
        }),
        script({
          path: "/hooks/config.ps1",
          stem: "config",
          event: "config",
          class: "observe",
          extension: ".ps1",
        }),
        script({
          path: "/hooks/chat-message.sh",
          stem: "chat-message",
          event: "chat.message",
          extension: ".sh",
        }),
        script({
          path: "/hooks/session-idle.ps1",
          stem: "session-idle",
          event: "session.idle",
          class: "observe",
          extension: ".ps1",
        }),
      ],
      UNAVAILABLE_SUBPROCESS,
    );

    const byName = new Map(
      registry.entries.map((entry) => [path.basename(entry.path), entry]),
    );
    const ps1Gate = byName.get("tool-execute-before.ps1")!;
    const ps1Observe = byName.get("config.ps1")!;
    const shGate = byName.get("chat-message.sh")!;
    const hostEventObserve = byName.get("session-idle.ps1")!;

    expect(ps1Gate.status).toBe("will-fail-closed");
    expect(ps1Gate.interpreter).toEqual({
      expected: "pwsh",
      available: false,
    });
    expect(ps1Observe.status).toBe("skipped-no-interpreter");
    expect(shGate.status).toBe("will-fail-closed");
    expect(hostEventObserve.status).toBe("skipped-no-interpreter");
    expect(hostEventObserve.class).toBe("observe");
  });

  test("should index an event-named hook under its host event", () => {
    const registry = buildRegistry(
      [
        script({
          path: "/hooks/session-idle.sh",
          stem: "session-idle",
          event: "session.idle",
          class: "observe",
        }),
      ],
      AVAILABLE,
    );

    expect(
      registry.byEvent["session.idle"].map((entry) =>
        path.basename(entry.path),
      ),
    ).toEqual(["session-idle.sh"]);
    expect(registry.byEvent["tool.execute.before"]).toEqual([]);
  });
});

describe("scanHooks", () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir !== undefined) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  const makeHooksDir = (): string => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "owflow-hooks-scan-test-"));
    const hooksDir = path.join(tempDir, ".owflow", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    return hooksDir;
  };

  test("should digest, resolve interpreters, and build the registry in one call", () => {
    const hooksDir = makeHooksDir();
    fs.writeFileSync(path.join(hooksDir, "tool-execute-before.sh"), "");

    const scan = scanHooks(hooksDir, { mode: HookDigestMode.Report, which: () => null });

    expect(scan.failures).toEqual([]);
    expect(scan.registry.entries).toHaveLength(1);
    expect(scan.registry.entries[0]!.event).toBe("tool.execute.before");
  });

  test("should collect failures in report mode and fail fast in throw mode", () => {
    const hooksDir = makeHooksDir();
    fs.writeFileSync(path.join(hooksDir, "readme.md"), "");

    const scan = scanHooks(hooksDir, { mode: HookDigestMode.Report });
    expect(scan.failures).toHaveLength(1);
    expect(scan.registry.entries).toEqual([]);
    expect(() => scanHooks(hooksDir)).toThrow(/1 invalid entry/);
  });

  test("should return an empty scan for an absent hooks directory", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "owflow-hooks-scan-test-"));
    const scan = scanHooks(path.join(tempDir, ".owflow", "hooks"));

    expect(scan.failures).toEqual([]);
    expect(scan.registry.entries).toEqual([]);
  });
});
