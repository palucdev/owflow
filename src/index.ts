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
import { digest } from "./hooks-wrapper/digest.js";
import { resolveInterpreterAvailability } from "./hooks-wrapper/interpreters.js";
import { buildRegistry } from "./hooks-wrapper/registry.js";
import { createExecutionCore } from "./hooks-wrapper/execution-core.js";
import { createDispatcher } from "./hooks-wrapper/dispatcher.js";
import type { Dispatcher } from "./hooks-wrapper/dispatcher.js";
import { renderSnapshot } from "./hooks-wrapper/report.js";
import type { HookReportInput } from "./hooks-wrapper/report.js";

// Only the plugin factory method should be exported from this file due to OpenCode plugin handling

const DROPPED_PLUGIN_HINT =
  "The owflow plugin — including the destructive-command guard — has been dropped because a hook script failed to load. " +
  "Hint: fix or remove the failing file and restart OpenCode, or set OWFLOW_HOOKS_DISABLED=1 to start without user hooks.";

interface HooksWrapper {
  readonly dispatch: Dispatcher;
  readonly snapshot: HookReportInput;
}

const initializeHooksWrapper = async (
  directory: string,
): Promise<HooksWrapper> => {
  const { entries } = digest(path.join(directory, ".owflow/hooks"), "throw");
  const registry = buildRegistry(entries, resolveInterpreterAvailability());
  const core = createExecutionCore({ cwd: directory });
  try {
    // R1.3: importing every in-process script now makes a broken default
    // export fatal at registration instead of at first fire.
    await core.load(registry.entries);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${detail}\n${DROPPED_PLUGIN_HINT}`);
  }
  return {
    dispatch: createDispatcher({ run: core.run, registry }),
    snapshot: { entries: registry.entries },
  };
};

const createDispatchHandlers = (dispatch: Dispatcher): Hooks => ({
  "tool.execute.after": async (input, output) => {
    await dispatch("tool.execute.after", input, output);
  },
  "tool.definition": async (input, output) => {
    await dispatch("tool.definition", input, output);
  },
  "chat.params": async (input, output) => {
    await dispatch("chat.params", input, output);
  },
  "chat.headers": async (input, output) => {
    await dispatch("chat.headers", input, output);
  },
  "command.execute.before": async (input, output) => {
    await dispatch("command.execute.before", input, output);
  },
  "shell.env": async (input, output) => {
    await dispatch("shell.env", input, output);
  },
  "experimental.chat.messages.transform": async (input, output) => {
    await dispatch("experimental.chat.messages.transform", input, output);
  },
  "experimental.chat.system.transform": async (input, output) => {
    await dispatch("experimental.chat.system.transform", input, output);
  },
  "experimental.compaction.autocontinue": async (input, output) => {
    await dispatch("experimental.compaction.autocontinue", input, output);
  },
  "experimental.text.complete": async (input, output) => {
    await dispatch("experimental.text.complete", input, output);
  },
  event: async (input) => {
    await dispatch("event", input);
  },
  dispose: async () => {
    await dispatch("dispose");
  },
});

const OwflowPlugin: Plugin = async ({ $, directory }) => {
  const agentBySession = new Map();
  const hooksDisabled = process.env.OWFLOW_HOOKS_DISABLED === "1";

  if (hooksDisabled) {
    console.log(
      "[owflow] User hooks disabled (OWFLOW_HOOKS_DISABLED=1); built-in hooks remain active.",
    );
  }
  const wrapper = hooksDisabled
    ? undefined
    : await initializeHooksWrapper(directory);
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
    config: async (config: unknown) => {
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
          await wrapper.dispatch("config", typedConfig);
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

    "experimental.session.compacting": async (input, output) => {
      await rereadOrchestratorState(directory, output);
      if (wrapper !== undefined) {
        await wrapper.dispatch("experimental.session.compacting", input, output);
      }
    },

    "chat.message": async (input, output) => {
      try {
        agentBySession.set(input.sessionID, input.agent ?? "main");
      } catch {
        // ignore
      }
      // Dispatch deliberately outside the swallowing catch so gate throws
      // propagate even when the platform's input object misbehaves.
      if (wrapper !== undefined) {
        await wrapper.dispatch("chat.message", input, output);
      }
    },

    "tool.execute.before": async (input, output) => {
      try {
        await guardAgainstDestructiveActions(input, output, agentBySession);
        if (wrapper !== undefined) {
          await wrapper.dispatch("tool.execute.before", input, output);
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
