import { describe, expect, test } from 'bun:test';
import { guardAgainstDestructiveActions, type GuardContext } from '../../../hooks/internal/before-tool.js';

const DEFAULT_INPUT = {
  tool: 'bash',
  sessionID: 'session-1',
  callID: 'call-1',
};

const createContext = (command: string | undefined, agentName: string | undefined): GuardContext => ({
  input: DEFAULT_INPUT,
  output: { args: command === undefined ? {} : { command } },
  agentBySessionMap: new Map<string, string>(agentName === undefined ? [] : [['session-1', agentName]]),
});

const WHITELIST_AGENTS = ['task-group-implementer', 'test-suite-runner', 'e2e-test-verifier', 'user-docs-generator', 'docs-operator'];

const SAFE_COMMANDS = ['git status', 'git push origin main', 'rm file.txt', 'rm -f file.txt', 'rm -r dir'];

const DESTRUCTIVE_COMMANDS = [
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

describe('guardAgainstDestructiveActions non-destructive paths', () => {
  test("should do nothing if tool is not 'bash'", async () => {
    const context = createContext('rm -rf /', 'main');
    const nonBashContext: GuardContext = { ...context, input: { ...DEFAULT_INPUT, tool: 'write_file' } };

    await expect(guardAgainstDestructiveActions(nonBashContext)).resolves.toBeUndefined();
  });

  test('should allow safe bash commands for non-whitelisted agents', async () => {
    for (const command of SAFE_COMMANDS) {
      await expect(guardAgainstDestructiveActions(createContext(command, 'main'))).resolves.toBeUndefined();
    }
  });

  test('should allow safe bash commands when command or args is empty/undefined', async () => {
    await expect(guardAgainstDestructiveActions(createContext(undefined, 'main'))).resolves.toBeUndefined();

    const missingArguments = { args: undefined } as unknown as GuardContext['output'];
    await expect(guardAgainstDestructiveActions({ ...createContext(undefined, 'main'), output: missingArguments })).resolves.toBeUndefined();
  });

  test('should allow destructive bash commands for whitelisted agents', async () => {
    for (const agentName of WHITELIST_AGENTS) {
      await expect(guardAgainstDestructiveActions(createContext('git reset --hard HEAD', agentName))).resolves.toBeUndefined();
    }
  });
});

describe('blocking destructive commands for non-whitelisted agents', () => {
  test.each(DESTRUCTIVE_COMMANDS)('should block destructive command: %s', async (command) => {
    await expect(guardAgainstDestructiveActions(createContext(command, 'main'))).rejects.toThrow(
      'Blocked: destructive command not permitted for agent "main"',
    );
  });

  test("should use session mapping agent name or default to 'main' in error message", async () => {
    await expect(guardAgainstDestructiveActions(createContext('git stash', 'codebase-analyzer'))).rejects.toThrow(
      'Blocked: destructive command not permitted for agent "codebase-analyzer"',
    );

    await expect(guardAgainstDestructiveActions(createContext('git stash', undefined))).rejects.toThrow(
      'Blocked: destructive command not permitted for agent "main"',
    );
  });
});
