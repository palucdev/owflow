import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as agentsConfig from '../configuration/agents-config.js';
import * as commandsConfig from '../configuration/commands-config.js';
import * as skillsConfig from '../configuration/skills-config.js';
import * as beforeTool from '../hooks/internal/before-tool.js';
import * as hooksWrapperModule from '../hooks/hooks-runtime.js';
import * as hooksPersistenceModule from '../hooks/hooks-persistence.js';
import * as sessionCompaction from '../hooks/internal/session-compaction.js';
import OwflowPlugin from '../index.js';
import { fork_task } from '../tools/fork_task.js';
import { verify_template } from '../tools/verify_template.js';

const mockPluginInput = (directory: string, client?: any) =>
  ({
    $: {} as any,
    directory,
    client: client ?? ({} as any),
    project: {} as any,
    worktree: directory,
    experimental_workspace: {} as any,
    serverUrl: new URL('http://localhost'),
  }) as any;

describe('OwflowPlugin', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'owflow-index-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('should export default plugin factory and register tools and hooks', async () => {
    const plugin = await OwflowPlugin(mockPluginInput(tmpDir));
    expect(plugin).toBeDefined();
    expect(plugin.tool?.verify_template).toBe(verify_template);
    expect(plugin.tool?.fork_task).toBe(fork_task);
    expect(typeof plugin.config).toBe('function');
    expect(typeof plugin['experimental.session.compacting']).toBe('function');
    expect(typeof plugin['chat.message']).toBe('function');
    expect(typeof plugin['tool.execute.before']).toBe('function');
    expect(typeof plugin.event).toBe('function');
    expect(typeof plugin.dispose).toBe('function');
  });

  describe('config hook', () => {
    test('should configure skills, commands, and agents from config', async () => {
      const skillsSpy = spyOn(skillsConfig, 'configureSkills').mockImplementation(() => {});
      const commandsSpy = spyOn(commandsConfig, 'configureCommands').mockImplementation(() => {});
      const agentsSpy = spyOn(agentsConfig, 'configureAgents').mockImplementation(() => {});
      const consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});

      try {
        const plugin = await OwflowPlugin(mockPluginInput(tmpDir));
        const inputConfig = {};

        await plugin.config!(inputConfig as any);

        expect(skillsSpy).toHaveBeenCalledWith(inputConfig as any);
        expect(commandsSpy).toHaveBeenCalledWith(inputConfig as any);
        expect(agentsSpy).toHaveBeenCalledWith(inputConfig as any);
      } finally {
        skillsSpy.mockRestore();
        commandsSpy.mockRestore();
        agentsSpy.mockRestore();
        consoleLogSpy.mockRestore();
      }
    });
  });

  describe('experimental.session.compacting hook', () => {
    test('should delegate to rereadOrchestratorState', async () => {
      const rereadSpy = spyOn(sessionCompaction, 'rereadOrchestratorState').mockImplementation(async () => {});

      try {
        const plugin = await OwflowPlugin(mockPluginInput(tmpDir));
        const output = { context: [] };
        await plugin['experimental.session.compacting']!({ sessionID: 'sess-1' }, output);

        expect(rereadSpy).toHaveBeenCalledWith(tmpDir, output);
      } finally {
        rereadSpy.mockRestore();
      }
    });
  });

  describe('chat.message and tool.execute.before hooks', () => {
    test('should track session agent and guard against destructive commands', async () => {
      const plugin = await OwflowPlugin(mockPluginInput(tmpDir));

      // Non-whitelisted agent
      await plugin['chat.message']!({ sessionID: 'sess-1', agent: 'codebase-analyzer' }, {} as any);
      await expect(
        plugin['tool.execute.before']!({ tool: 'bash', sessionID: 'sess-1', callID: 'c-1' }, { args: { command: 'git reset --hard' } }),
      ).rejects.toThrow('Blocked: destructive command not permitted for agent "codebase-analyzer"');

      // Update existing session agent to a whitelisted agent
      await plugin['chat.message']!({ sessionID: 'sess-1', agent: 'task-group-implementer' }, {} as any);
      await expect(
        plugin['tool.execute.before']!({ tool: 'bash', sessionID: 'sess-1', callID: 'c-1b' }, { args: { command: 'git reset --hard' } }),
      ).resolves.toBeUndefined();

      // Default to "main" when agent is unspecified
      await plugin['chat.message']!({ sessionID: 'sess-2' }, {} as any);
      await expect(
        plugin['tool.execute.before']!({ tool: 'bash', sessionID: 'sess-2', callID: 'c-2' }, { args: { command: 'git stash' } }),
      ).rejects.toThrow('Blocked: destructive command not permitted for agent "main"');
    });

    test("should rethrow 'Blocked:' errors and swallow/warn unexpected errors", async () => {
      const guardSpy = spyOn(beforeTool, 'guardAgainstDestructiveActions').mockImplementation(async () => {
        throw new Error('Unexpected database error');
      });
      const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

      try {
        const plugin = await OwflowPlugin(mockPluginInput(tmpDir));
        await expect(
          plugin['tool.execute.before']!({ tool: 'bash', sessionID: 's-1', callID: 'c-1' }, { args: { command: 'ls' } }),
        ).resolves.toBeUndefined();
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('failing open'));
      } finally {
        guardSpy.mockRestore();
        warnSpy.mockRestore();
      }
    });
  });

  describe('user hooks wrapper integration', () => {
    test('should return only built-in hooks when OWFLOW_HOOKS_DISABLED=1', async () => {
      const prev = process.env.OWFLOW_HOOKS_DISABLED;
      process.env.OWFLOW_HOOKS_DISABLED = '1';
      const consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});

      try {
        const plugin = await OwflowPlugin(mockPluginInput(tmpDir));
        expect(plugin.tool).toBeDefined();
        expect(plugin.config).toBeDefined();
        expect(plugin['tool.execute.before']).toBeDefined();
        expect(plugin.event).toBeUndefined();
        expect(plugin.dispose).toBeUndefined();
        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('OWFLOW_HOOKS_DISABLED=1'));
      } finally {
        consoleLogSpy.mockRestore();
        if (prev === undefined) delete process.env.OWFLOW_HOOKS_DISABLED;
        else process.env.OWFLOW_HOOKS_DISABLED = prev;
      }
    });

    test('should abort session via client when gate hook fails and warn on client abort error', async () => {
      const aborts: Array<{ path: { id: string } }> = [];
      const client = {
        session: {
          abort: async (opts: { path: { id: string } }) => {
            aborts.push(opts);
            if (opts.path.id === 'sess-abort-err') throw new Error('Client network error');
          },
        },
      };

      const wrapperSpy = spyOn(hooksWrapperModule, 'initializeHooksWrapper').mockImplementation(async (_dir, endSession) => ({
        dispatch: async (_event, input: any) => {
          if (endSession && input?.sessionID) await endSession(input.sessionID);
          throw new Error('Blocked: gate check failed');
        },
        snapshot: { entries: [] },
        dispose: () => {},
      }));
      const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

      try {
        const plugin = await OwflowPlugin(mockPluginInput(tmpDir, client));
        await expect(
          plugin['tool.execute.before']!({ tool: 'bash', sessionID: 'sess-gate-fail', callID: 'c-1' }, { args: { command: 'ls' } }),
        ).rejects.toThrow('Blocked: gate check failed');

        expect(aborts).toEqual([{ path: { id: 'sess-gate-fail' } }]);

        // When client.session.abort throws, logs a warning
        await expect(
          plugin['tool.execute.before']!({ tool: 'bash', sessionID: 'sess-abort-err', callID: 'c-2' }, { args: { command: 'ls' } }),
        ).rejects.toThrow('Blocked: gate check failed');

        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('failed to end session sess-abort-err'));
      } finally {
        wrapperSpy.mockRestore();
        warnSpy.mockRestore();
      }
    });

    test('should call user dispose and cleanup on dispose', async () => {
      let wrapperDisposed = false;
      const wrapperSpy = spyOn(hooksWrapperModule, 'initializeHooksWrapper').mockResolvedValue({
        dispatch: async () => {},
        snapshot: { entries: [] },
        dispose: () => {
          wrapperDisposed = true;
        },
      });

      try {
        const plugin = await OwflowPlugin(mockPluginInput(tmpDir));
        await plugin.dispose?.();
        expect(wrapperDisposed).toBe(true);
      } finally {
        wrapperSpy.mockRestore();
      }
    });

    test('should maintain built-in destructive action guard and write crash log when user hooks fail initialization', async () => {
      const crashSpy = spyOn(hooksPersistenceModule, 'writeHookCrashLog').mockImplementation(() => {});
      const wrapperSpy = spyOn(hooksWrapperModule, 'initializeHooksWrapper').mockRejectedValue(new Error('SyntaxError in user hook script'));
      const errorSpy = spyOn(console, 'error').mockImplementation(() => {});

      try {
        const plugin = await OwflowPlugin(mockPluginInput(tmpDir));

        expect(crashSpy).toHaveBeenCalledWith(tmpDir, 'startup_digest_failed', expect.any(Error));
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('user hooks failed to load'));
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('destructive command guard remains ACTIVE'));

        // Plugin is returned in safe-mode
        expect(plugin.tool).toBeDefined();
        expect(plugin['tool.execute.before']).toBeDefined();
        expect(plugin.event).toBeUndefined();

        // Destructive command guard remains 100% active and blocks destructive actions
        await plugin['chat.message']!({ sessionID: 'sess-guard', agent: 'main' }, {} as any);
        await expect(
          plugin['tool.execute.before']!({ tool: 'bash', sessionID: 'sess-guard', callID: 'c-crash' }, { args: { command: 'git reset --hard' } }),
        ).rejects.toThrow('Blocked: destructive command not permitted for agent "main"');
      } finally {
        crashSpy.mockRestore();
        wrapperSpy.mockRestore();
        errorSpy.mockRestore();
      }
    });
  });
});
