/**
 * Owflow OpenCode Plugin
 * Registers skills/agents/commands via OpenCode's JS event system.
 */

import type { Hooks, Plugin } from "@opencode-ai/plugin";

import path from "node:path";
import fs from "node:fs";

import { PLUGIN_VERSION } from "./utils/plugin-info.js";
import type { OpenCodeConfig } from "./types/opencode-types.js";
import { verify_template } from "./tools/verify_template.js";
import { fork_task } from "./tools/fork_task.js";
import { rereadOrchestratorState } from "./hooks/session-compaction.js";
import { guardAgainstDestructiveActions } from "./hooks/before-tool.js";
import { configureSkills } from "./configuration/skills-config.js";
import { configureCommands } from "./configuration/commands-config.js";
import { configureAgents } from "./configuration/agents-config.js";
import {
  createDispatchHandlers,
  initializeHooksWrapper,
} from "./hooks/plugin-hooks.js";
import { renderSnapshot } from "./hooks-wrapper/report.js";
import { HookEvent } from "./types/hook-types.js";
import type { HookReportInput } from "./types/hook-types.js";

// Only the plugin factory method should be exported from this file due to OpenCode plugin handling

const OwflowPlugin: Plugin = async ({ $, client, directory }) => {
  const agentBySession = new Map<string, string>();
  const hooksDisabled = process.env.OWFLOW_HOOKS_DISABLED === "1";

  if (hooksDisabled) {
    console.log(
      "[owflow] User hooks disabled (OWFLOW_HOOKS_DISABLED=1); built-in hooks remain active.",
    );
  }
  const endSession = async (sessionID: string): Promise<void> => {
    if (typeof client?.session?.abort !== "function") return;
    try {
      await client.session.abort({ path: { id: sessionID } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[owflow] failed to end session ${sessionID} after a gate hook failed: ${message}`,
      );
    }
  };
  const wrapper = hooksDisabled
    ? undefined
    : await initializeHooksWrapper(directory, endSession);
  const snapshot: HookReportInput =
    wrapper?.snapshot ?? { entries: [], bypassed: true };

  const hooks: Hooks = {
    tool: {
      verify_template,
      fork_task,
    },
    /**
     * Register owflow's skills, commands, and agents so OpenCode discovers
     * them without requiring manual config file edits.
     */
    [HookEvent.Config]: async (config: unknown) => {
      console.log(
        `[owflow] Starting plugin installation (v${PLUGIN_VERSION})...`,
      );
      for (const line of renderSnapshot(snapshot)) console.log(line);
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

      // Observe-class user scripts run after every built-in config mutation;
      // their failures stay log-only and can never break installation.
      if (wrapper !== undefined) {
        try {
          await wrapper.dispatch(HookEvent.Config, typedConfig);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          console.warn(`[owflow] config hook dispatch failed: ${message}`);
        }
      }

      console.log(
        `[owflow] Plugin installation completed successfully (v${PLUGIN_VERSION}).`,
      );
    },

    [HookEvent.ExperimentalSessionCompacting]: async (input, output) => {
      await rereadOrchestratorState(directory, output);
      if (wrapper !== undefined) {
        await wrapper.dispatch(
          HookEvent.ExperimentalSessionCompacting,
          input,
          output,
        );
      }
    },

    [HookEvent.ChatMessage]: async (input, output) => {
      try {
        agentBySession.set(input.sessionID, input.agent ?? "main");
      } catch {
        // ignore
      }
      // Dispatch deliberately outside the swallowing catch so gate throws
      // propagate even when the platform's input object misbehaves.
      if (wrapper !== undefined) {
        await wrapper.dispatch(HookEvent.ChatMessage, input, output);
      }
    },

    [HookEvent.ToolExecuteBefore]: async (input, output) => {
      try {
        await guardAgainstDestructiveActions(input, output, agentBySession);
        if (wrapper !== undefined) {
          await wrapper.dispatch(HookEvent.ToolExecuteBefore, input, output);
        }
      } catch (e) {
        // Re-throw only intentional blocks; swallow unexpected errors
        if ((e as Error).message?.startsWith("Blocked:")) throw e;
      }
    },
  };

  if (wrapper === undefined) return hooks;
  return { ...hooks, ...createDispatchHandlers(wrapper.dispatch) };
};

export default OwflowPlugin;
