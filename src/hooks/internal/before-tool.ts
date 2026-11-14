export interface GuardContext {
  readonly input: { readonly tool: string; readonly sessionID: string };
  readonly output: { readonly args?: Record<string, unknown> };
  readonly agentBySessionMap: ReadonlyMap<string, string>;
}

const WHITELIST_AGENTS: ReadonlySet<string> = new Set([
  'task-group-implementer',
  'test-suite-runner',
  'e2e-test-verifier',
  'user-docs-generator',
  'docs-operator',
]);

const isDestructiveGitCommand = (command: string): boolean => {
  if (!/\bgit\b/i.test(command)) {
    return false;
  }
  if (
    /\bgit\s+stash\b/i.test(command) ||
    /\bgit\s+clean\b/i.test(command) ||
    /\bgit\s+checkout\s+--\s+\./i.test(command) ||
    /\bgit\s+checkout\s+\.(?:\s|$)/i.test(command)
  ) {
    return true;
  }
  if (/\bgit\s+reset\b/i.test(command) && /\s--hard\b/i.test(command)) {
    return true;
  }
  if (/\bgit\s+push\b/i.test(command)) {
    const hasForceFlag = /\s(?:--force(?:-with-lease)?|-f)\b/i.test(command);
    const hasPlusReference = /\s\+[a-z0-9_\-/]+/i.test(command);
    return hasForceFlag || hasPlusReference;
  }
  return false;
};

const hasShortRecursiveAndForceFlags = (arguments_: readonly string[]): boolean => {
  let hasRecursiveFlag = false;
  let hasForceFlag = false;
  for (const argument_ of arguments_) {
    if (!argument_.startsWith('-') || argument_.startsWith('--')) {
      continue;
    }
    const flags = argument_.slice(1);
    if (flags.includes('r') || flags.includes('R')) {
      hasRecursiveFlag = true;
    }
    if (flags.includes('f')) {
      hasForceFlag = true;
    }
  }
  return hasRecursiveFlag && hasForceFlag;
};

const isDestructiveRmCommand = (command: string): boolean => {
  if (!/\brm\b/i.test(command)) {
    return false;
  }
  const hasRecursiveLong = /\s--recursive\b/i.test(command);
  const hasForceLong = /\s--force\b/i.test(command);
  if (hasRecursiveLong && hasForceLong) {
    return true;
  }
  const tokens = command.split(/\s+/);
  const rmIndex = tokens.findIndex((token) => token === 'rm' || token.endsWith('/rm'));
  if (rmIndex === -1) {
    return false;
  }
  const commandArguments = tokens.slice(rmIndex + 1);
  return hasShortRecursiveAndForceFlags(commandArguments);
};

const isDestructiveCommand = (command: string): boolean =>
  isDestructiveGitCommand(command) || isDestructiveRmCommand(command);

const extractGuardContext = (
  contextOrInput: GuardContext | { tool: string; sessionID: string },
  remainingArguments: readonly [
    output?: { args?: Record<string, unknown> },
    agentBySessionMap?: ReadonlyMap<string, string>,
  ],
): GuardContext => {
  if ('agentBySessionMap' in contextOrInput) {
    return contextOrInput;
  }
  return {
    input: contextOrInput,
    output: remainingArguments[0] ?? {},
    agentBySessionMap: remainingArguments[1] ?? new Map<string, string>(),
  };
};

export const guardAgainstDestructiveActions = async (
  contextOrInput: GuardContext | { tool: string; sessionID: string },
  ...remainingArguments: [
    output?: { args?: Record<string, unknown> },
    agentBySessionMap?: ReadonlyMap<string, string>,
  ] | []
): Promise<void> => {
  const { input, output, agentBySessionMap } = extractGuardContext(
    contextOrInput,
    remainingArguments,
  );

  if (input.tool !== 'bash') {
    return;
  }

  const agentName = agentBySessionMap.get(input.sessionID) ?? 'main';
  if (WHITELIST_AGENTS.has(agentName)) {
    return;
  }

  const command = (output?.args?.['command'] as string | undefined) ?? '';
  if (isDestructiveCommand(command)) {
    throw new Error(`Blocked: destructive command not permitted for agent "${agentName}"`);
  }
};
