import { describe, expect, test } from "bun:test";
import { guardAgainstDestructiveActions } from "../../hooks/before-tool.js";

describe("guardAgainstDestructiveActions", () => {
  const defaultInput = {
    tool: "bash",
    sessionID: "session-1",
    callID: "call-1",
  };

  test("should do nothing if tool is not 'bash'", async () => {
    const input = { ...defaultInput, tool: "write_file" };
    const output = { args: { command: "rm -rf /" } };
    const map = new Map<string, string>([["session-1", "main"]]);

    await expect(
      guardAgainstDestructiveActions(input, output, map),
    ).resolves.toBeUndefined();
  });

  test("should allow safe bash commands for non-whitelisted agents", async () => {
    const output = { args: { command: "git status" } };
    const map = new Map<string, string>([["session-1", "main"]]);

    await expect(
      guardAgainstDestructiveActions(defaultInput, output, map),
    ).resolves.toBeUndefined();
  });

  test("should allow safe bash commands when command or args is empty/undefined", async () => {
    const map = new Map<string, string>([["session-1", "main"]]);

    await expect(
      guardAgainstDestructiveActions(
        defaultInput,
        { args: {} },
        map,
      ),
    ).resolves.toBeUndefined();

    await expect(
      guardAgainstDestructiveActions(
        defaultInput,
        { args: undefined } as any,
        map,
      ),
    ).resolves.toBeUndefined();
  });

  test("should allow destructive bash commands for whitelisted agents", async () => {
    const WHITELIST = [
      "task-group-implementer",
      "test-suite-runner",
      "e2e-test-verifier",
      "user-docs-generator",
      "docs-operator",
    ];

    const output = { args: { command: "git reset --hard HEAD" } };

    for (const agentName of WHITELIST) {
      const map = new Map<string, string>([["session-1", agentName]]);
      await expect(
        guardAgainstDestructiveActions(defaultInput, output, map),
      ).resolves.toBeUndefined();
    }
  });

  describe("blocking destructive commands for non-whitelisted agents", () => {
    const destructiveCommands = [
      "git stash",
      "git reset --hard",
      "git reset --hard HEAD~1",
      "git checkout -- .",
      "git checkout .",
      "git clean -fd",
      "git push --force origin main",
      "git push -f origin main",
      "rm -rf dist",
      "rm -fr temp",
    ];

    test.each(destructiveCommands)(
      "should block destructive command: %s",
      async (cmd) => {
        const output = { args: { command: cmd } };
        const map = new Map<string, string>([["session-1", "main"]]);

        await expect(
          guardAgainstDestructiveActions(defaultInput, output, map),
        ).rejects.toThrow(
          'Blocked: destructive command not permitted for agent "main"',
        );
      },
    );

    test("should use session mapping agent name or default to 'main' in error message", async () => {
      const output = { args: { command: "git stash" } };
      
      // Mapped agent
      const mapWithAgent = new Map<string, string>([
        ["session-1", "codebase-analyzer"],
      ]);
      await expect(
        guardAgainstDestructiveActions(defaultInput, output, mapWithAgent),
      ).rejects.toThrow(
        'Blocked: destructive command not permitted for agent "codebase-analyzer"',
      );

      // Unmapped session defaults to "main"
      const emptyMap = new Map<string, string>();
      await expect(
        guardAgainstDestructiveActions(defaultInput, output, emptyMap),
      ).rejects.toThrow(
        'Blocked: destructive command not permitted for agent "main"',
      );
    });
  });
});
