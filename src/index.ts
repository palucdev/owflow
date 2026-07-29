/**
 * Owflow OpenCode Plugin
 * Registers skills/agents/commands via OpenCode's JS event system.
 */

import type { Plugin } from "@opencode-ai/plugin";

import path from "node:path";
import fs from "node:fs";

import type { OpenCodeConfig } from "./types/opencode-types.js";
import { verify_template } from "./tools/verify_template.js";
import { rereadOrchestratorState } from "./hooks/session-compaction.js";
import { guardAgainstDestructiveActions } from "./hooks/before-tool.js";
import { configureSkills } from "./configuration/skills-config.js";
import { configureCommands } from "./configuration/commands-config.js";
import { configureAgents } from "./configuration/agents-config.js";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PLUGIN_ROOT = __dirname; // Points to dist/ where skills/commands/agents are copied

const OwflowPlugin: Plugin = async ({ $, directory }) => {
  const agentBySession = new Map();
  return {
    tool: {
      verify_template,
    },
    /**
     * Register owflow's skills, commands, and agents so OpenCode discovers
     * them without requiring manual config file edits.
     */
    config: async (config: unknown) => {
      console.log("[owflow] Starting plugin installation...");
      let typedConfig = config as OpenCodeConfig;

      // Get small_model config for alias resolution
      // Try from config parameter first, fallback to reading opencode.json
      let smallModel = typedConfig.small_model ?? "";

      if (!smallModel) {
        try {
          // Check project-level opencode.json
          const projectConfigPath = path.join(directory, "opencode.json");
          if (fs.existsSync(projectConfigPath)) {
            const rawConfig = fs.readFileSync(projectConfigPath, "utf8");
            const opencodeConfig = JSON.parse(rawConfig);
            smallModel = opencodeConfig.small_model;
          }
        } catch (error) {
          console.warn(
            `Couldn't read or parse opencode.json config - small_model remains undefined`,
          );
        }
      }

      configureSkills(typedConfig);
      configureCommands(typedConfig);
      configureAgents(typedConfig, smallModel);

      config = typedConfig;
      console.log("[owflow] Plugin installation completed successfully.");
    },

    "experimental.session.compacting": async (input, output) => {
      await rereadOrchestratorState(directory, output);
    },

    "chat.message": async (input, _output) => {
      try {
        agentBySession.set(input.sessionID, input.agent ?? "main");
      } catch {
        // ignore
      }
    },

    "tool.execute.before": async (input, output) => {
      try {
        await guardAgainstDestructiveActions(input, output, agentBySession);
      } catch (e) {
        // Re-throw only intentional blocks; swallow unexpected errors
        if ((e as Error).message?.startsWith("Blocked:")) throw e;
      }
    },
  };
};

export default OwflowPlugin;
