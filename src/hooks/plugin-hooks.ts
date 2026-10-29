import type { Hooks } from "@opencode-ai/plugin";

import { createDispatcher } from "../hooks-wrapper/dispatcher.js";
import { scanHooks } from "../hooks-wrapper/registry.js";
import { createSubprocessRunner } from "../hooks-wrapper/runners.js";
import {
  createHookLogStore,
  resolveHooksLogFile,
} from "../hooks-wrapper/hook-logs.js";
import {
  createHookStatusStore,
  resolveHooksStatusFile,
} from "../hooks-wrapper/status.js";
import { HookEvent, isHostEventName } from "../types/hook-types.js";
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

export interface HooksWrapper {
  readonly dispatch: Dispatcher;
  readonly snapshot: HookReportInput;
  dispose(): void;
}

export interface HooksWrapperOptions {
  readonly statusFile?: string;
  readonly logFile?: string;
}

export const initializeHooksWrapper = async (
  directory: string,
  endSession?: (sessionID: string) => Promise<void> | void,
  options: HooksWrapperOptions = {},
): Promise<HooksWrapper> => {
  const { registry } = scanHooks(hooksDirectory(directory));
  // Creation writes the initial empty snapshot, clearing stale statuses from a
  // previous OpenCode run before the first hook fires.
  const statusStore = createHookStatusStore({
    file: options.statusFile ?? resolveHooksStatusFile(directory),
    workspace: directory,
  });
  const logStore = createHookLogStore({
    file: options.logFile ?? resolveHooksLogFile(directory),
    workspace: directory,
  });

  const runner = createSubprocessRunner({ cwd: directory });
  return {
    dispatch: createDispatcher({
      run: runner.run,
      registry,
      endSession,
      onStatus: (report) => statusStore.observe(report),
      onRunLog: (report) => logStore.record(report),
    }),
    snapshot: { entries: registry.entries },
    dispose: () => {
      runner.dispose?.();
      statusStore.dispose();
    },
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
  HookEvent.Dispose,
] as const satisfies readonly DispatchableEvent[];

const hostEventTypeFrom = (input: unknown): string | undefined => {
  if (typeof input !== "object" || input === null) return undefined;
  const event = (input as { event?: unknown }).event;
  if (typeof event !== "object" || event === null) return undefined;
  const type = (event as { type?: unknown }).type;
  return typeof type === "string" ? type : undefined;
};

export const createDispatchHandlers = (dispatch: Dispatcher): Hooks => {
  const handlers = Object.fromEntries(
    PASSTHROUGH_EVENTS.map((event) => [
      event,
      (input?: unknown, output?: Record<string, unknown>) =>
        dispatch(event, input, output),
    ]),
  ) as Hooks;

  const eventChains = new Map<string, Promise<void>>();
  const runSerialized = (
    key: string,
    task: () => Promise<void>,
  ): Promise<void> => {
    const previous = eventChains.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    const tracked = next.finally(() => {
      if (eventChains.get(key) === tracked) {
        eventChains.delete(key);
      }
    });
    eventChains.set(key, tracked);
    return next;
  };

  return {
    ...handlers,
    [HookEvent.Event]: async (input: unknown) => {
      const type = hostEventTypeFrom(input);
      if (type !== undefined && isHostEventName(type)) {
        await runSerialized(type, () => dispatch(type, input));
      }
      await runSerialized(HookEvent.Event, () =>
        dispatch(HookEvent.Event, input),
      );
    },
  };
};
