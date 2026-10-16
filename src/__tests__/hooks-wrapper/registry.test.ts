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
  EXTENSION_RANK,
  HOOK_EXTENSIONS,
  buildRegistry,
  deriveHook,
  digest,
  isHookExtension,
  resolveInterpreterAvailability,
  runnerClassForExtension,
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
  test("should route each extension to its runner class at the pinned extension rank", () => {
    expect(runnerClassForExtension(".ts")).toBe("in-process");
    expect(runnerClassForExtension(".js")).toBe("in-process");
    expect(runnerClassForExtension(".sh")).toBe("subprocess");
    expect(runnerClassForExtension(".ps1")).toBe("subprocess");

    expect(
      HOOK_EXTENSIONS.map((extension) => EXTENSION_RANK[extension]),
    ).toEqual([0, 1, 2, 3]);

    expect(isHookExtension(".ts")).toBe(true);
    expect(isHookExtension(".ps1")).toBe(true);
    expect(isHookExtension(".md")).toBe(false);
    expect(isHookExtension("ts")).toBe(false);
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
      expect(availability[".ts"]).toEqual({ available: true });
      expect(availability[".js"]).toEqual({ available: true });

      // In-process extensions never consult the PATH lookup, and a pwsh hit
      // means the Windows fallback candidate is never probed.
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
    expect(availability[".ts"]).toEqual({ available: true });
    expect(availability[".js"]).toEqual({ available: true });
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

    expect(digest(hooksDir, "throw")).toEqual({ entries: [], failures: [] });

    fs.mkdirSync(hooksDir, { recursive: true });
    expect(digest(hooksDir, "throw")).toEqual({ entries: [], failures: [] });
    expect(digest(hooksDir, "report")).toEqual({ entries: [], failures: [] });
  });

  test("should fail fast on every invalid entry and collect all violations without throwing in report mode", () => {
    const hooksDir = makeHooksDir();

    fs.writeFileSync(path.join(hooksDir, "tool-execute-before.ts"), "");
    fs.writeFileSync(path.join(hooksDir, "tool-execute-befor.ts"), "");
    fs.writeFileSync(path.join(hooksDir, "permission-ask.ts"), "");
    fs.writeFileSync(path.join(hooksDir, "bad_stem.ts"), "");
    fs.writeFileSync(path.join(hooksDir, "readme.md"), "");
    fs.mkdirSync(path.join(hooksDir, "notes"));

    const failurePaths = [
      path.join(hooksDir, "bad_stem.ts"),
      path.join(hooksDir, "notes"),
      path.join(hooksDir, "permission-ask.ts"),
      path.join(hooksDir, "readme.md"),
      path.join(hooksDir, "tool-execute-befor.ts"),
    ];

    expect(() => digest(hooksDir, "throw")).toThrow();
    try {
      digest(hooksDir, "throw");
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

    const report = digest(hooksDir, "report");
    expect(report.failures.map((failure) => failure.path)).toEqual(failurePaths);
    for (const failure of report.failures) {
      expect(failure.error.length).toBeGreaterThan(0);
    }

    const errorFor = (name: string): string =>
      report.failures.find((failure) => failure.path.endsWith(name))!.error;
    expect(errorFor("bad_stem.ts")).toContain("kebab-case");
    expect(errorFor("notes")).toContain("regular file");
    expect(errorFor("permission-ask.ts")).toContain("excluded");
    expect(errorFor("readme.md")).toContain("routable");
    expect(errorFor("tool-execute-befor.ts")).toContain(
      "not a dispatchable event",
    );
    expect(errorFor("tool-execute-befor.ts")).toContain("tool.execute.befor");

    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]!.path).toBe(
      path.join(hooksDir, "tool-execute-before.ts"),
    );
    expect(report.entries[0]!.event).toBe("tool.execute.before");
    expect(report.entries[0]!.class).toBe("gate");
    expect(report.entries[0]!.runnerClass).toBe("in-process");
  });
});

const script = (overrides: Partial<HookScript>): HookScript => ({
  path: "/hooks/tool-execute-before.ts",
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
  ".sh": { resolved: "bash", available: true },
  ".ps1": { resolved: "pwsh", available: true },
};

const UNAVAILABLE_SUBPROCESS: InterpreterAvailability = {
  ".ts": { available: true },
  ".js": { available: true },
  ".sh": { expected: "bash", available: false },
  ".ps1": { expected: "pwsh", available: false },
};

describe("buildRegistry", () => {
  test("should order entries by event and extension rank", () => {
    const registry = buildRegistry(
      [
        script({
          path: "/hooks/tool-execute-before.sh",
          stem: "tool-execute-before",
          extension: ".sh",
          runnerClass: "subprocess",
        }),
        script({
          path: "/hooks/config.ts",
          stem: "config",
          event: "config",
          class: "observe",
        }),
        script({
          path: "/hooks/tool-execute-before.js",
          stem: "tool-execute-before",
          extension: ".js",
        }),
        script({
          path: "/hooks/chat-message.ts",
          stem: "chat-message",
          event: "chat.message",
        }),
        script({
          path: "/hooks/tool-execute-before.ts",
          stem: "tool-execute-before",
          extension: ".ts",
        }),
      ],
      AVAILABLE,
    );

    expect(registry.entries.map((entry) => path.basename(entry.path))).toEqual([
      "chat-message.ts",
      "config.ts",
      "tool-execute-before.ts",
      "tool-execute-before.js",
      "tool-execute-before.sh",
    ]);

    expect(
      registry.byEvent["tool.execute.before"].map((entry) =>
        path.basename(entry.path),
      ),
    ).toEqual([
      "tool-execute-before.ts",
      "tool-execute-before.js",
      "tool-execute-before.sh",
    ]);
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
          runnerClass: "subprocess",
        }),
        script({
          path: "/hooks/config.ps1",
          stem: "config",
          event: "config",
          class: "observe",
          extension: ".ps1",
          runnerClass: "subprocess",
        }),
        script({
          path: "/hooks/chat-message.sh",
          stem: "chat-message",
          event: "chat.message",
          extension: ".sh",
          runnerClass: "subprocess",
        }),
        script({
          path: "/hooks/tool-execute-before.ts",
          stem: "tool-execute-before",
          extension: ".ts",
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

    expect(ps1Gate.status).toBe("will-fail-closed");
    expect(ps1Gate.interpreter).toEqual({
      expected: "pwsh",
      available: false,
    });
    expect(ps1Observe.status).toBe("skipped-no-interpreter");
    expect(shGate.status).toBe("will-fail-closed");

    const inProcess = byName.get("tool-execute-before.ts")!;
    expect(inProcess.status).toBe("registered");
    expect(inProcess.interpreter.available).toBe(true);
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
    fs.writeFileSync(path.join(hooksDir, "tool-execute-before.ts"), "");

    const scan = scanHooks(hooksDir, { mode: "report", which: () => null });

    expect(scan.failures).toEqual([]);
    expect(scan.registry.entries).toHaveLength(1);
    expect(scan.registry.entries[0]!.event).toBe("tool.execute.before");
  });

  test("should collect failures in report mode and fail fast in throw mode", () => {
    const hooksDir = makeHooksDir();
    fs.writeFileSync(path.join(hooksDir, "readme.md"), "");

    const scan = scanHooks(hooksDir, { mode: "report" });
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
