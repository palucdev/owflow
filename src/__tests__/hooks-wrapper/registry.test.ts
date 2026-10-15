import { describe, expect, test } from "bun:test";
import path from "node:path";
import { buildRegistry } from "../../hooks-wrapper/registry.js";
import type {
  HookScript,
  InterpreterAvailability,
} from "../../hooks-wrapper/types.js";

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
  test("should order entries by event, stem, and extension rank and deep-freeze the registry", () => {
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

    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.entries)).toBe(true);
    expect(Object.isFrozen(registry.byEvent)).toBe(true);
    expect(Object.isFrozen(registry.entries[0])).toBe(true);
    expect(Object.isFrozen(registry.entries[0]!.interpreter)).toBe(true);
    expect(Object.isFrozen(registry.byEvent["tool.execute.before"])).toBe(true);

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
