/**
 * Owflow OpenCode Plugin
 * Registers skills/agents/commands via OpenCode's JS event system.
 */

import type { Hooks, Plugin } from '@opencode-ai/plugin';

import { PLUGIN_VERSION } from './utils/plugin-info.js';
import type { OpenCodeConfig } from './types/opencode-types.js';
import { verify_template } from './tools/verify_template.js';
import { fork_task } from './tools/fork_task.js';
import { rereadOrchestratorState } from './hooks/internal/session-compaction.js';
import { guardAgainstDestructiveActions } from './hooks/internal/before-tool.js';
import { configureSkills } from './configuration/skills-config.js';
import { configureCommands } from './configuration/commands-config.js';
import { configureAgents } from './configuration/agents-config.js';
import { HookEvent, type HookReportInput } from './types/hook-types.js';
import { renderSnapshot } from './hooks/hooks-diagnostics.js';
import { writeHookCrashLog } from './hooks/hooks-persistence.js';
import HooksWrapper from './hooks/hooks-wrapper.js';

// Only the plugin factory method should be exported from this file due to OpenCode plugin handling

const MAX_TRACKED_SESSIONS = 256;

const OwflowPlugin: Plugin = async ({ $, client, directory }) => {
  const agentBySession = new Map<string, string>();
  const hooksDisabled = process.env.OWFLOW_HOOKS_DISABLED === '1';
  let configLoaded = false;

  if (hooksDisabled) {
    console.log('[owflow] User hooks disabled (OWFLOW_HOOKS_DISABLED=1); built-in hooks remain active.');
  }
  const endSession = async (sessionID: string): Promise<void> => {
    if (typeof client?.session?.abort !== 'function') return;
    try {
      await client.session.abort({ path: { id: sessionID } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[owflow] failed to end session ${sessionID} after a gate hook failed: ${message}`);
    }
  };

  let wrapper: HooksWrapper | undefined;
  let snapshot: HookReportInput = { entries: [], bypassed: true };

  if (!hooksDisabled) {
    try {
      wrapper = new HooksWrapper(directory, endSession);
      snapshot = wrapper.snapshot;
    } catch (error) {
      writeHookCrashLog(directory, 'startup_digest_failed', error);
      console.error(`[owflow] ERROR: user hooks failed to load (${(error as Error).message}).`);
      console.error(`[owflow] Built-in destructive command guard remains ACTIVE.`);
      console.error(`[owflow] User hooks bypassed until fixed. See crash log.`);
      wrapper = undefined;
    }
  }

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
      if (!configLoaded) {
        console.log(`[owflow] Starting plugin installation (v${PLUGIN_VERSION})...`);
        for (const line of renderSnapshot(snapshot)) console.log(line);
      }
      let typedConfig = config as OpenCodeConfig;

      configureSkills(typedConfig);
      configureCommands(typedConfig);
      configureAgents(typedConfig);

      // User scripts run after built-in config mutations; failing closed on rejection.
      if (wrapper !== undefined) {
        await wrapper.dispatch(HookEvent.Config, typedConfig);
      }

      if (!configLoaded) {
        console.log(`[owflow] Plugin installation completed successfully (v${PLUGIN_VERSION}).`);
        configLoaded = true;
      }
    },

    [HookEvent.ExperimentalSessionCompacting]: async (input, output) => {
      await rereadOrchestratorState(directory, output);
      if (wrapper !== undefined) {
        await wrapper.dispatch(HookEvent.ExperimentalSessionCompacting, input, output);
      }
    },

    [HookEvent.ChatMessage]: async (input, output) => {
      try {
        if (agentBySession.has(input.sessionID)) {
          agentBySession.delete(input.sessionID);
        }
        agentBySession.set(input.sessionID, input.agent ?? 'main');
        while (agentBySession.size > MAX_TRACKED_SESSIONS) {
          const oldest = agentBySession.keys().next().value;
          if (oldest !== undefined) agentBySession.delete(oldest);
        }
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
        // Re-throw only intentional blocks; log and swallow unexpected errors
        if ((e as Error).message?.startsWith('Blocked:')) throw e;
        const message = e instanceof Error ? e.message : String(e);
        console.warn(`[owflow] hooks: unexpected error in tool.execute.before (failing open): ${message}`);
      }
    },
  };

  // No wrapper - no support for user defined hooks, return owflow hook configs
  if (wrapper === undefined) return hooks;

  // Return full plugin configuration with user hooks support
  const dispatchHandlers = wrapper.createDispatchHandlers();
  const userDispose = dispatchHandlers.dispose;
  return {
    ...hooks,
    ...dispatchHandlers,
    dispose: async () => {
      try {
        await userDispose?.();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[owflow] error during user dispose hook: ${msg}`);
      } finally {
        wrapper.dispose();
        agentBySession.clear();
      }
    },
  };
};

export default OwflowPlugin;
