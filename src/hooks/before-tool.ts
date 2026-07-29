export const guardAgainstDestructiveActions = async (
  input: {
    tool: string;
    sessionID: string;
    callID: string;
  },
  output: {
    args: any;
  },
  agentBySessionMap: Map<string, string>,
): Promise<void> => {
  if (input.tool !== "bash") return;

  const agentName = agentBySessionMap.get(input.sessionID) ?? "main";
  const WHITELIST = [
    "task-group-implementer",
    "test-suite-runner",
    "e2e-test-verifier",
    "user-docs-generator",
    "docs-operator",
  ];
  if (WHITELIST.includes(agentName)) return;
  const cmd = output?.args?.command ?? "";
  const DESTRUCTIVE =
    /git\s+stash|git\s+reset\s+--hard|git\s+checkout\s+--\s+\.|git\s+checkout\s+\.\s*(?:$|\s)|git\s+clean|git\s+push\s+(?:--force|-f)|rm\s+-[rf]{2}/i;
  if (DESTRUCTIVE.test(cmd)) {
    throw new Error(
      `Blocked: destructive command not permitted for agent "${agentName}"`,
    );
  }
};
