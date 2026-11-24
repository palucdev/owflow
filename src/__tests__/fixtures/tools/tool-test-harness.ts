import type { ToolContext, ToolResult } from '@opencode-ai/plugin';

export const createToolContext = (directory: string): ToolContext => ({
  sessionID: 'test-session',
  messageID: 'test-message',
  agent: 'test-agent',
  directory,
  worktree: directory,
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
});

export const outputOf = (result: ToolResult): string => {
  if (typeof result === 'string') {
    throw new TypeError(`expected a tool output object, got: ${result}`);
  }
  return result.output;
};
