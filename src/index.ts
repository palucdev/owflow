// Owflow OpenCode Plugin
// Registers skills/agents/commands via OpenCode's JS event system.

import type { Hooks, Plugin, PluginInput } from '@opencode-ai/plugin';

import { PLUGIN_VERSION } from './utils/plugin-info.js';
import type { OpenCodeConfig } from './types/opencode-types.js';
import { verify_template } from './tools/verify-template.js';
import { fork_task } from './tools/fork-task.js';
import { rereadOrchestratorState } from './hooks/internal/session-compaction.js';
import { guardAgainstDestructiveActions } from './hooks/internal/before-tool.js';
import { configureSkills } from './configuration/skills-config.js';
import { configureCommands } from './configuration/commands-config.js';
import { configureAgents } from './configuration/agents-config.js';
import { HookEvent, type HookReportInput } from './types/hook-types.js';
import { renderSnapshot } from './hooks/hooks-diagnostics.js';
import { writeHookCrashLog } from './hooks/hooks-persistence.js';
import HooksWrapper from './hooks/hooks-wrapper.js';
import { createDefaultEnvironmentConfig, type EnvironmentConfig } from './utils/environment-config.js';

// Only the plugin factory method should be exported from this file due to OpenCode plugin handling

const MAX_TRACKED_SESSIONS = 256;

type ConfigHook = NonNullable<Hooks['config']>;
type ChatMessageHook = NonNullable<Hooks['chat.message']>;
type SessionCompactionHook = NonNullable<Hooks['experimental.session.compacting']>;
type ToolExecuteBeforeHook = NonNullable<Hooks['tool.execute.before']>;
type DisposeHook = NonNullable<Hooks['dispose']>;

const formatErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const createEndSession = (client: PluginInput['client']) =>
  async (sessionID: string): Promise<void> => {
    if (typeof client?.session?.abort !== 'function') return;
    try {
      await client.session.abort({ path: { id: sessionID } });
    } catch (error) {
      console.warn(`[owflow] failed to end session ${sessionID} after a gate hook failed: ${formatErrorMessage(error)}`);
    }
  };

interface WrapperCreationOptions {
  readonly client: PluginInput['client'];
  readonly directory: string;
  readonly config: EnvironmentConfig;
}

const createHooksWrapper = (options: WrapperCreationOptions): HooksWrapper | undefined => {
  if (options.config.isHooksDisabled) {
    console.log('[owflow] User hooks disabled (OWFLOW_HOOKS_DISABLED=1); built-in hooks remain active.');
    return undefined;
  }

  try {
    return new HooksWrapper(options.directory, createEndSession(options.client));
  } catch (error) {
    writeHookCrashLog(options.directory, 'startup_digest_failed', error);
    console.error(`[owflow] ERROR: user hooks failed to load (${formatErrorMessage(error)}).`);
    console.error('[owflow] Built-in destructive command guard remains ACTIVE.');
    console.error('[owflow] User hooks bypassed until fixed. See crash log.');
    return undefined;
  }
};

const snapshotFromWrapper = (wrapper: HooksWrapper | undefined): HookReportInput =>
  wrapper?.snapshot ?? { entries: [], bypassed: true };

const logInstallationStart = (snapshot: HookReportInput): void => {
  console.log(`[owflow] Starting plugin installation (v${PLUGIN_VERSION})...`);
  for (const line of renderSnapshot(snapshot)) console.log(line);
};

const applyPluginConfig = (config: OpenCodeConfig): void => {
  configureSkills(config);
  configureCommands(config);
  configureAgents(config);
};

interface ConfigHookOptions {
  readonly wrapper: HooksWrapper | undefined;
  readonly snapshot: HookReportInput;
}

const createConfigHook = (options: ConfigHookOptions): ConfigHook => {
  let isConfigLoaded = false;

  return async (config) => {
    if (!isConfigLoaded) logInstallationStart(options.snapshot);

    const typedConfig = config as OpenCodeConfig;
    applyPluginConfig(typedConfig);
    if (options.wrapper !== undefined) await options.wrapper.dispatch(HookEvent.Config, typedConfig);

    if (isConfigLoaded) return;
    console.log(`[owflow] Plugin installation completed successfully (v${PLUGIN_VERSION}).`);
    isConfigLoaded = true;
  };
};

interface SessionCompactionOptions {
  readonly directory: string;
  readonly wrapper: HooksWrapper | undefined;
}

const createSessionCompactionHook = (options: SessionCompactionOptions): SessionCompactionHook =>
  async (input, output) => {
    await rereadOrchestratorState(options.directory, output);
    if (options.wrapper !== undefined) {
      await options.wrapper.dispatch(HookEvent.ExperimentalSessionCompacting, input, output);
    }
  };

interface AgentTrackingOptions {
  readonly wrapper: HooksWrapper | undefined;
  readonly agentBySession: Map<string, string>;
}

const trackAgentSession = (
  agentBySession: Map<string, string>,
  input: { readonly sessionID: string; readonly agent?: string },
): void => {
  try {
    if (agentBySession.has(input.sessionID)) agentBySession.delete(input.sessionID);
    agentBySession.set(input.sessionID, input.agent ?? 'main');
    while (agentBySession.size > MAX_TRACKED_SESSIONS) {
      const oldest = agentBySession.keys().next().value;
      if (oldest !== undefined) agentBySession.delete(oldest);
    }
  } catch {
    // Ignore malformed host payloads; tracking is best-effort.
  }
};

const createChatMessageHook = (options: AgentTrackingOptions): ChatMessageHook =>
  async (input, output) => {
    trackAgentSession(options.agentBySession, input);
    if (options.wrapper !== undefined) {
      await options.wrapper.dispatch(HookEvent.ChatMessage, input, output);
    }
  };

const isBlockedError = (error: unknown): boolean => error instanceof Error && error.message.startsWith('Blocked:');

const createToolExecuteBeforeHook = (options: AgentTrackingOptions): ToolExecuteBeforeHook =>
  async (input, output) => {
    try {
      await guardAgainstDestructiveActions(input, output, options.agentBySession);
      if (options.wrapper !== undefined) {
        await options.wrapper.dispatch(HookEvent.ToolExecuteBefore, input, output);
      }
    } catch (error) {
      if (isBlockedError(error)) throw error;
      console.warn(`[owflow] hooks: unexpected error in tool.execute.before (failing open): ${formatErrorMessage(error)}`);
    }
  };

interface DisposeHookOptions {
  readonly wrapper: HooksWrapper;
  readonly userDispose: Hooks['dispose'];
  readonly agentBySession: Map<string, string>;
}

const createDisposeHook = (options: DisposeHookOptions): DisposeHook =>
  async () => {
    try {
      await options.userDispose?.();
    } catch (error) {
      console.warn(`[owflow] error during user dispose hook: ${formatErrorMessage(error)}`);
    } finally {
      options.wrapper.dispose();
      options.agentBySession.clear();
    }
  };

const OwflowPlugin: Plugin = async ({ client, directory }) => {
  const config = createDefaultEnvironmentConfig();
  const wrapper = createHooksWrapper({ client, directory, config });
  const agentBySession = new Map<string, string>();

  const hooks: Hooks = {
    tool: {
      verify_template,
      fork_task,
    },
    [HookEvent.Config]: createConfigHook({ wrapper, snapshot: snapshotFromWrapper(wrapper) }),
    [HookEvent.ExperimentalSessionCompacting]: createSessionCompactionHook({ directory, wrapper }),
    [HookEvent.ChatMessage]: createChatMessageHook({ wrapper, agentBySession }),
    [HookEvent.ToolExecuteBefore]: createToolExecuteBeforeHook({ wrapper, agentBySession }),
  };

  if (wrapper === undefined) return hooks;

  const dispatchHandlers = wrapper.createDispatchHandlers();
  return {
    ...hooks,
    ...dispatchHandlers,
    dispose: createDisposeHook({ wrapper, userDispose: dispatchHandlers.dispose, agentBySession }),
  };
};

export default OwflowPlugin;
