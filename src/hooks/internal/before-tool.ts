import { HookFailureTracker, MAX_HOOK_FAILURES } from '../runtime/failure-policy.js';

export const defaultFailureTracker = new HookFailureTracker();

export const guardAgainstDestructiveActions = async (
  input: {
    tool: string;
    sessionID: string;
  },
  output: {
    args: any;
  },
  agentBySessionMap: Map<string, string>,
  endSession?: (sessionID: string) => Promise<void> | void,
  tracker: HookFailureTracker = defaultFailureTracker,
): Promise<void> => {
  if (input.tool !== 'bash') return;

  const agentName = agentBySessionMap.get(input.sessionID) ?? 'main';
  const WHITELIST = ['task-group-implementer', 'test-suite-runner', 'e2e-test-verifier', 'user-docs-generator', 'docs-operator'];
  if (WHITELIST.includes(agentName)) return;
  const command = output?.args?.command ?? '';
  const DESTRUCTIVE =
    /git\s+stash|git\s+reset(?:\s+.*?)?\s+--hard|git\s+checkout\s+--\s+\.|git\s+checkout\s+\.\s*(?:$|\s)|git\s+clean|git\s+push\s+(?:.*?\s)?(?:--force(?:-with-lease)?|-f|\+[a-z0-9_\-\/]+)|rm\s+.*?(?:-[a-z]*[rf][a-z]*\s+-[a-z]*[rf]|-[rf]{2}|--recursive\s+--force|--force\s+--recursive)/i;
  if (DESTRUCTIVE.test(command)) {
    const attempt = tracker.recordFailure('destructive_guard', input.sessionID);
    if (attempt < MAX_HOOK_FAILURES) {
      throw new Error(
        `Blocked: destructive command not permitted for agent "${agentName}" (attempt ${attempt}/${MAX_HOOK_FAILURES}). Hint: Destructive commands like git reset --hard, git stash, and rm -rf are prohibited. Inspect files or ask the user instead.`,
      );
    }
    await endSession?.(input.sessionID);
    throw new Error(
      `Blocked: destructive command attempted 3 times for agent "${agentName}". CRITICAL: Halting conversation to prevent repository corruption. Hint: Ask the user for manual intervention.`,
    );
  }

  tracker.recordSuccess('destructive_guard', input.sessionID);
};
