import { beforeEach, describe, expect, test } from 'bun:test';
import { defaultFailureTracker, guardAgainstDestructiveActions } from '../../../hooks/internal/before-tool.js';
import { HookFailureTracker } from '../../../hooks/runtime/failure-policy.js';

describe('guardAgainstDestructiveActions', () => {
  const defaultInput = {
    tool: 'bash',
    sessionID: 'session-1',
    callID: 'call-1',
  };

  beforeEach(() => {
    defaultFailureTracker.clear();
  });

  test("should do nothing if tool is not 'bash'", async () => {
    const input = { ...defaultInput, tool: 'write_file' };
    const output = { args: { command: 'rm -rf /' } };
    const map = new Map<string, string>([['session-1', 'main']]);

    await expect(guardAgainstDestructiveActions(input, output, map)).resolves.toBeUndefined();
  });

  test('should allow safe bash commands for non-whitelisted agents', async () => {
    const safeCommands = ['git status', 'git push origin main', 'rm file.txt', 'rm -f file.txt', 'rm -r dir'];
    const map = new Map<string, string>([['session-1', 'main']]);

    for (const cmd of safeCommands) {
      const output = { args: { command: cmd } };
      await expect(guardAgainstDestructiveActions(defaultInput, output, map)).resolves.toBeUndefined();
    }
  });

  test('should allow safe bash commands when command or args is empty/undefined', async () => {
    const map = new Map<string, string>([['session-1', 'main']]);

    await expect(guardAgainstDestructiveActions(defaultInput, { args: {} }, map)).resolves.toBeUndefined();

    await expect(guardAgainstDestructiveActions(defaultInput, { args: undefined } as any, map)).resolves.toBeUndefined();
  });

  test('should allow destructive bash commands for whitelisted agents', async () => {
    const WHITELIST = ['task-group-implementer', 'test-suite-runner', 'e2e-test-verifier', 'user-docs-generator', 'docs-operator'];

    const output = { args: { command: 'git reset --hard HEAD' } };

    for (const agentName of WHITELIST) {
      const map = new Map<string, string>([['session-1', agentName]]);
      await expect(guardAgainstDestructiveActions(defaultInput, output, map)).resolves.toBeUndefined();
    }
  });

  describe('blocking destructive commands for non-whitelisted agents', () => {
    const destructiveCommands = [
      'git stash',
      'git reset --hard',
      'git reset --hard HEAD~1',
      'git reset origin/main --hard',
      'git reset HEAD~1 --hard',
      'git checkout -- .',
      'git checkout .',
      'git clean -fd',
      'git push --force origin main',
      'git push -f origin main',
      'git push --force-with-lease origin main',
      'git push origin +main',
      'rm -rf dist',
      'rm -fr temp',
      'rm -r -f temp',
      'rm -f -r temp',
      'rm --recursive --force temp',
      'rm --force --recursive temp',
    ];

    test.each(destructiveCommands)('should block destructive command: %s', async (cmd) => {
      const output = { args: { command: cmd } };
      const map = new Map<string, string>([['session-1', 'main']]);

      await expect(guardAgainstDestructiveActions(defaultInput, output, map)).rejects.toThrow(
        'Blocked: destructive command not permitted for agent "main"',
      );
    });

    test("should use session mapping agent name or default to 'main' in error message", async () => {
      const output = { args: { command: 'git stash' } };

      // Mapped agent
      const mapWithAgent = new Map<string, string>([['session-1', 'codebase-analyzer']]);
      await expect(guardAgainstDestructiveActions(defaultInput, output, mapWithAgent)).rejects.toThrow(
        'Blocked: destructive command not permitted for agent "codebase-analyzer"',
      );

      // Unmapped session defaults to "main"
      const emptyMap = new Map<string, string>();
      await expect(guardAgainstDestructiveActions(defaultInput, output, emptyMap)).rejects.toThrow(
        'Blocked: destructive command not permitted for agent "main"',
      );
    });

    test('should track attempts and escalate on 3rd attempt', async () => {
      const output = { args: { command: 'git stash' } };
      const map = new Map<string, string>([['session-1', 'main']]);
      const endedSessions: string[] = [];
      const endSession = (id: string) => {
        endedSessions.push(id);
      };
      const customTracker = new HookFailureTracker();

      // Attempt 1
      await expect(guardAgainstDestructiveActions(defaultInput, output, map, endSession, customTracker)).rejects.toThrow(
        'Blocked: destructive command not permitted for agent "main" (attempt 1/3). Hint: Destructive commands like git reset --hard, git stash, and rm -rf are prohibited. Inspect files or ask the user instead.',
      );
      expect(endedSessions).toEqual([]);

      // Attempt 2
      await expect(guardAgainstDestructiveActions(defaultInput, output, map, endSession, customTracker)).rejects.toThrow(
        'Blocked: destructive command not permitted for agent "main" (attempt 2/3). Hint: Destructive commands like git reset --hard, git stash, and rm -rf are prohibited. Inspect files or ask the user instead.',
      );
      expect(endedSessions).toEqual([]);

      // Attempt 3
      await expect(guardAgainstDestructiveActions(defaultInput, output, map, endSession, customTracker)).rejects.toThrow(
        'Blocked: destructive command attempted 3 times for agent "main". CRITICAL: Halting conversation to prevent repository corruption. Hint: Ask the user for manual intervention.',
      );
      expect(endedSessions).toEqual(['session-1']);
    });

    test('should reset attempt count on successful safe command', async () => {
      const destructiveOutput = { args: { command: 'git stash' } };
      const safeOutput = { args: { command: 'git status' } };
      const map = new Map<string, string>([['session-1', 'main']]);
      const customTracker = new HookFailureTracker();

      // Attempt 1
      await expect(guardAgainstDestructiveActions(defaultInput, destructiveOutput, map, undefined, customTracker)).rejects.toThrow(/(attempt 1\/3)/);
      expect(customTracker.getCount('destructive_guard', 'session-1')).toBe(1);

      // Safe command resets
      await guardAgainstDestructiveActions(defaultInput, safeOutput, map, undefined, customTracker);
      expect(customTracker.getCount('destructive_guard', 'session-1')).toBe(0);

      // Next failure should be attempt 1 again
      await expect(guardAgainstDestructiveActions(defaultInput, destructiveOutput, map, undefined, customTracker)).rejects.toThrow(/(attempt 1\/3)/);
    });
  });
});
