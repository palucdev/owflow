export const OWFLOW_MUTATION_VERSION = 1;

export interface OwflowMutationEnvelope {
  $owflow: typeof OWFLOW_MUTATION_VERSION;
  mutate: unknown;
  hint: string;
  reason?: string;
}

export interface ChatMessageMutation {
  message?: {
    agent?: string;
    model?: { providerID: string; modelID: string };
    system?: string;
    tools?: Record<string, boolean>;
  };
  parts?: unknown[];
}

export interface ChatParamsMutation {
  temperature?: number | null;
  topP?: number | null;
  topK?: number | null;
  maxOutputTokens?: number | null;
  options?: Record<string, unknown>;
}

export interface ChatHeadersMutation {
  headers?: Record<string, string>;
}

export interface CommandExecuteBeforeMutation {
  parts?: unknown[];
}

export interface ToolDefinitionMutation {
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface ToolExecuteBeforeMutation {
  args?: Record<string, unknown>;
}

export interface ToolExecuteAfterMutation {
  title?: string;
  output?: string;
  metadata?: Record<string, unknown>;
}

export interface ShellEnvMutation {
  env?: Record<string, string>;
}

export interface HookMutationMap {
  'chat.message': ChatMessageMutation;
  'chat.params': ChatParamsMutation;
  'chat.headers': ChatHeadersMutation;
  'command.execute.before': CommandExecuteBeforeMutation;
  'tool.definition': ToolDefinitionMutation;
  'tool.execute.before': ToolExecuteBeforeMutation;
  'tool.execute.after': ToolExecuteAfterMutation;
  'shell.env': ShellEnvMutation;
}

export type MutableHookEvent = keyof HookMutationMap;
export type HookMutationFor<E extends MutableHookEvent> = HookMutationMap[E];
