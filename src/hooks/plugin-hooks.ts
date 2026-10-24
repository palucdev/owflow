import type { Hooks } from "@opencode-ai/plugin";

import { createDispatcher } from "../hooks-wrapper/dispatcher.js";
import { scanHooks } from "../hooks-wrapper/registry.js";
import { createExecutionCore } from "../hooks-wrapper/runners.js";
import {
  createHookStatusStore,
  resolveHooksStatusFile,
} from "../hooks-wrapper/status.js";
import { HookEvent } from "../types/hook-types.js";
import type {
  Dispatcher,
  DispatchableEvent,
  HookReportInput,
} from "../types/hook-types.js";
import { hooksDirectory } from "../utils/workflow-paths.js";

/**
 * Server-side wiring for the user-hooks wrapper. Keeping it here leaves
 * `src/index.ts` focused on plugin composition while all hook-specific
 * constants, initialization, and handler construction live together.
 */

export const DROPPED_PLUGIN_HINT =
  "The owflow plugin — including the destructive-command guard — has been dropped because a hook script failed to load. " +
  "Hint: fix or remove the failing file and restart OpenCode, or set OWFLOW_HOOKS_DISABLED=1 to start without user hooks.";

export interface HooksWrapper {
  readonly dispatch: Dispatcher;
  readonly snapshot: HookReportInput;
  dispose(): void;
}

export interface HooksWrapperOptions {
  readonly statusFile?: string;
}

export const initializeHooksWrapper = async (
  directory: string,
  endSession?: (sessionID: string) => Promise<void> | void,
  options: HooksWrapperOptions = {},
): Promise<HooksWrapper> => {
  const { registry } = scanHooks(hooksDirectory(directory));
  const core = createExecutionCore({ cwd: directory });
  try {
    // Importing every in-process script now makes a broken default export
    // fatal at registration instead of at first fire.
    await core.load(registry.entries);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${detail}\n${DROPPED_PLUGIN_HINT}`);
  }
  // Creation writes the initial empty snapshot, clearing stale statuses from a
  // previous OpenCode run before the first hook fires.
  const statusStore = createHookStatusStore({
    file: options.statusFile ?? resolveHooksStatusFile(directory),
    workspace: directory,
  });
  return {
    dispatch: createDispatcher({
      run: core.run,
      registry,
      endSession,
      onStatus: (report) => statusStore.observe(report),
    }),
    snapshot: { entries: registry.entries },
    dispose: () => statusStore.dispose(),
  };
};

/** Events composed explicitly elsewhere are excluded from the passthrough set. */
export const PASSTHROUGH_EVENTS = [
  HookEvent.ToolExecuteAfter,
  HookEvent.ToolDefinition,
  HookEvent.ChatParams,
  HookEvent.ChatHeaders,
  HookEvent.CommandExecuteBefore,
  HookEvent.ShellEnv,
  HookEvent.ExperimentalChatMessagesTransform,
  HookEvent.ExperimentalChatSystemTransform,
  HookEvent.ExperimentalCompactionAutocontinue,
  HookEvent.ExperimentalTextComplete,
  HookEvent.Event,
  HookEvent.Dispose,
] as const satisfies readonly DispatchableEvent[];

export const createDispatchHandlers = (dispatch: Dispatcher): Hooks =>
  Object.fromEntries(
    PASSTHROUGH_EVENTS.map((event) => [
      event,
      (input?: unknown, output?: Record<string, unknown>) =>
        dispatch(event, input, output),
    ]),
  ) as Hooks;
