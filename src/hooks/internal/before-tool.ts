export const guardAgainstDestructiveActions = async (
  input: {
    tool: string;
    sessionID: string;
  },
  output: {
    args: any;
  },
  agentBySessionMap: Map<string, string>,
): Promise<void> => {
  if (input.tool !== 'bash') return;

  const agentName = agentBySessionMap.get(input.sessionID) ?? 'main';
  const WHITELIST = ['task-group-implementer', 'test-suite-runner', 'e2e-test-verifier', 'user-docs-generator', 'docs-operator'];
  if (WHITELIST.includes(agentName)) return;
  const cmd = output?.args?.command ?? '';
  const DESTRUCTIVE =
    /git\s+stash|git\s+reset(?:\s+.*?)?\s+--hard|git\s+checkout\s+--\s+\.|git\s+checkout\s+\.\s*(?:$|\s)|git\s+clean|git\s+push\s+(?:.*?\s)?(?:--force(?:-with-lease)?|-f|\+[a-z0-9_\-\/]+)|rm\s+.*?(?:-[a-z]*[rf][a-z]*\s+-[a-z]*[rf]|-[rf]{2}|--recursive\s+--force|--force\s+--recursive)/i;
  if (DESTRUCTIVE.test(cmd)) {
    throw new Error(`Blocked: destructive command not permitted for agent "${agentName}"`);
  }
};
