import { describe, expect, test, spyOn, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import OwflowPlugin, { PLUGIN_ROOT } from "../index.js";
import * as skillsConfig from "../configuration/skills-config.js";
import * as commandsConfig from "../configuration/commands-config.js";
import * as agentsConfig from "../configuration/agents-config.js";
import * as sessionCompaction from "../hooks/session-compaction.js";
import * as beforeTool from "../hooks/before-tool.js";
import { verify_template } from "../tools/verify_template.js";

const mockPluginInput = (directory: string) =>
  ({
    $: {} as any,
    directory,
    client: {} as any,
    project: {} as any,
    worktree: directory,
    experimental_workspace: {} as any,
    serverUrl: new URL("http://localhost"),
  }) as any;

describe("OwflowPlugin index", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "owflow-index-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("should export PLUGIN_ROOT and default plugin factory", async () => {
    expect(PLUGIN_ROOT).toBeDefined();
    expect(typeof PLUGIN_ROOT).toBe("string");

    const plugin = await OwflowPlugin(mockPluginInput(tmpDir));
    expect(plugin).toBeDefined();
    expect(plugin.tool).toBeDefined();
    expect(plugin.tool!.verify_template).toBe(verify_template);
    expect(typeof plugin.config).toBe("function");
    expect(typeof plugin["experimental.session.compacting"]).toBe("function");
    expect(typeof plugin["chat.message"]).toBe("function");
    expect(typeof plugin["tool.execute.before"]).toBe("function");
  });

  describe("config hook", () => {
    test("should use small_model directly from input config if provided", async () => {
      const skillsSpy = spyOn(skillsConfig, "configureSkills").mockImplementation(() => {});
      const commandsSpy = spyOn(commandsConfig, "configureCommands").mockImplementation(() => {});
      const agentsSpy = spyOn(agentsConfig, "configureAgents").mockImplementation(() => {});
      const consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});

      try {
        const plugin = await OwflowPlugin(mockPluginInput(tmpDir));
        const inputConfig = { small_model: "test-haiku" };

        await plugin.config!(inputConfig as any);

        expect(skillsSpy).toHaveBeenCalledWith(inputConfig as any);
        expect(commandsSpy).toHaveBeenCalledWith(inputConfig as any);
        expect(agentsSpy).toHaveBeenCalledWith(inputConfig as any, "test-haiku");
        expect(consoleLogSpy).toHaveBeenCalledWith("[owflow] Starting plugin installation...");
        expect(consoleLogSpy).toHaveBeenCalledWith("[owflow] Plugin installation completed successfully.");
      } finally {
        skillsSpy.mockRestore();
        commandsSpy.mockRestore();
        agentsSpy.mockRestore();
        consoleLogSpy.mockRestore();
      }
    });

    test("should read small_model from project opencode.json if not in config", async () => {
      const opencodeJsonPath = path.join(tmpDir, "opencode.json");
      fs.writeFileSync(opencodeJsonPath, JSON.stringify({ small_model: "file-haiku" }), "utf8");

      const skillsSpy = spyOn(skillsConfig, "configureSkills").mockImplementation(() => {});
      const commandsSpy = spyOn(commandsConfig, "configureCommands").mockImplementation(() => {});
      const agentsSpy = spyOn(agentsConfig, "configureAgents").mockImplementation(() => {});
      const consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});

      try {
        const plugin = await OwflowPlugin(mockPluginInput(tmpDir));
        const inputConfig = {};

        await plugin.config!(inputConfig as any);

        expect(agentsSpy).toHaveBeenCalledWith(inputConfig as any, "file-haiku");
      } finally {
        skillsSpy.mockRestore();
        commandsSpy.mockRestore();
        agentsSpy.mockRestore();
        consoleLogSpy.mockRestore();
      }
    });

    test("should warn when reading opencode.json fails or has invalid JSON", async () => {
      const opencodeJsonPath = path.join(tmpDir, "opencode.json");
      fs.writeFileSync(opencodeJsonPath, "invalid-json{", "utf8");

      const skillsSpy = spyOn(skillsConfig, "configureSkills").mockImplementation(() => {});
      const commandsSpy = spyOn(commandsConfig, "configureCommands").mockImplementation(() => {});
      const agentsSpy = spyOn(agentsConfig, "configureAgents").mockImplementation(() => {});
      const consoleWarnSpy = spyOn(console, "warn").mockImplementation(() => {});
      const consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});

      try {
        const plugin = await OwflowPlugin(mockPluginInput(tmpDir));
        const inputConfig = {};

        await plugin.config!(inputConfig as any);

        expect(consoleWarnSpy).toHaveBeenCalledWith(
          "Couldn't read or parse opencode.json config - small_model remains undefined"
        );
        expect(agentsSpy).toHaveBeenCalledWith(inputConfig as any, "");
      } finally {
        skillsSpy.mockRestore();
        commandsSpy.mockRestore();
        agentsSpy.mockRestore();
        consoleWarnSpy.mockRestore();
        consoleLogSpy.mockRestore();
      }
    });
  });

  describe("experimental.session.compacting hook", () => {
    test("should delegate to rereadOrchestratorState with directory and output", async () => {
      const rereadSpy = spyOn(sessionCompaction, "rereadOrchestratorState").mockImplementation(async () => {});

      try {
        const plugin = await OwflowPlugin(mockPluginInput(tmpDir));
        const output = { context: [] };

        await plugin["experimental.session.compacting"]!({ sessionID: "sess-test" }, output);

        expect(rereadSpy).toHaveBeenCalledWith(tmpDir, output);
      } finally {
        rereadSpy.mockRestore();
      }
    });
  });

  describe("chat.message and tool.execute.before hooks", () => {
    test("should track session agent on chat.message and pass to tool.execute.before", async () => {
      const plugin = await OwflowPlugin(mockPluginInput(tmpDir));

      // Record chat message with custom agent
      await plugin["chat.message"]!({ sessionID: "sess-123", agent: "codebase-analyzer" }, {} as any);

      // Call tool.execute.before with destructive action for non-whitelisted agent
      const input = { tool: "bash", sessionID: "sess-123", callID: "c-1" };
      const output = { args: { command: "git reset --hard" } };

      await expect(plugin["tool.execute.before"]!(input, output)).rejects.toThrow(
        'Blocked: destructive command not permitted for agent "codebase-analyzer"'
      );
    });

    test("should default agent to 'main' when chat.message input.agent is undefined", async () => {
      const plugin = await OwflowPlugin(mockPluginInput(tmpDir));

      await plugin["chat.message"]!({ sessionID: "sess-default" }, {} as any);

      const input = { tool: "bash", sessionID: "sess-default", callID: "c-2" };
      const output = { args: { command: "git stash" } };

      await expect(plugin["tool.execute.before"]!(input, output)).rejects.toThrow(
        'Blocked: destructive command not permitted for agent "main"'
      );
    });

    test("should catch and ignore errors inside chat.message hook", async () => {
      const plugin = await OwflowPlugin(mockPluginInput(tmpDir));

      // Pass an invalid object to trigger internal error if any, or test resilience
      const badInput = { get sessionID() { throw new Error("Session access error"); } };

      await expect(plugin["chat.message"]!(badInput as any, {} as any)).resolves.toBeUndefined();
    });

    test("should re-throw 'Blocked:' error from guardAgainstDestructiveActions", async () => {
      const guardSpy = spyOn(beforeTool, "guardAgainstDestructiveActions").mockImplementation(async () => {
        throw new Error("Blocked: custom block message");
      });

      try {
        const plugin = await OwflowPlugin(mockPluginInput(tmpDir));
        const input = { tool: "bash", sessionID: "sess-test", callID: "c-3" };
        const output = { args: { command: "rm -rf /" } };

        await expect(plugin["tool.execute.before"]!(input, output)).rejects.toThrow(
          "Blocked: custom block message"
        );
      } finally {
        guardSpy.mockRestore();
      }
    });

    test("should swallow non-'Blocked:' errors from guardAgainstDestructiveActions", async () => {
      const guardSpy = spyOn(beforeTool, "guardAgainstDestructiveActions").mockImplementation(async () => {
        throw new Error("Unexpected database connection error");
      });

      try {
        const plugin = await OwflowPlugin(mockPluginInput(tmpDir));
        const input = { tool: "bash", sessionID: "sess-test", callID: "c-4" };
        const output = { args: { command: "ls" } };

        await expect(plugin["tool.execute.before"]!(input, output)).resolves.toBeUndefined();
      } finally {
        guardSpy.mockRestore();
      }
    });
  });
});
