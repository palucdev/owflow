import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as agentsConfig from '../configuration/agents-config.js';
import * as commandsConfig from '../configuration/commands-config.js';
import * as skillsConfig from '../configuration/skills-config.js';
import * as beforeTool from '../hooks/internal/before-tool.js';
import * as sessionCompaction from '../hooks/internal/session-compaction.js';
import OwflowPlugin from '../index.js';
import { fork_task } from '../tools/fork-task.js';
import { verify_template } from '../tools/verify-template.js';
import { NOOP, mockPluginInput } from './index-test-helpers.js';

const workspace = { directory: '' };

beforeEach(() => {
  workspace.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'owflow-index-test-'));
});

afterEach(() => {
  if (fs.existsSync(workspace.directory)) {
    fs.rmSync(workspace.directory, { recursive: true, force: true });
  }
});

describe('OwflowPlugin registration', () => {
  test('should export default plugin factory and register tools and hooks', async () => {
    const plugin = await OwflowPlugin(mockPluginInput(workspace.directory));
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
});

describe('config hook', () => {
  test('should configure skills, commands, and agents from config', async () => {
    const skillsSpy = spyOn(skillsConfig, 'configureSkills').mockImplementation(NOOP);
    const commandsSpy = spyOn(commandsConfig, 'configureCommands').mockImplementation(NOOP);
    const agentsSpy = spyOn(agentsConfig, 'configureAgents').mockImplementation(NOOP);
    const consoleLogSpy = spyOn(console, 'log').mockImplementation(NOOP);

    try {
      const plugin = await OwflowPlugin(mockPluginInput(workspace.directory));
      const inputConfig = {};

      await plugin.config!(inputConfig as never);

      expect(skillsSpy).toHaveBeenCalledWith(inputConfig);
      expect(commandsSpy).toHaveBeenCalledWith(inputConfig);
      expect(agentsSpy).toHaveBeenCalledWith(inputConfig);
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
      const plugin = await OwflowPlugin(mockPluginInput(workspace.directory));
      const output = { context: [] };
      await plugin['experimental.session.compacting']!({ sessionID: 'sess-1' }, output as never);

      expect(rereadSpy).toHaveBeenCalledWith(workspace.directory, output);
    } finally {
      rereadSpy.mockRestore();
    }
  });
});

describe('chat.message and tool.execute.before hooks', () => {
  test('should track session agent and guard against destructive commands', async () => {
    const plugin = await OwflowPlugin(mockPluginInput(workspace.directory));

    // Non-whitelisted agent
    await plugin['chat.message']!({ sessionID: 'sess-1', agent: 'codebase-analyzer' }, {} as never);
    await expect(
      plugin['tool.execute.before']!({ tool: 'bash', sessionID: 'sess-1', callID: 'c-1' }, { args: { command: 'git reset --hard' } }),
    ).rejects.toThrow('Blocked: destructive command not permitted for agent "codebase-analyzer"');

    // Update existing session agent to a whitelisted agent
    await plugin['chat.message']!({ sessionID: 'sess-1', agent: 'task-group-implementer' }, {} as never);
    await expect(
      plugin['tool.execute.before']!({ tool: 'bash', sessionID: 'sess-1', callID: 'c-1b' }, { args: { command: 'git reset --hard' } }),
    ).resolves.toBeUndefined();

    // Default to "main" when agent is unspecified
    await plugin['chat.message']!({ sessionID: 'sess-2' }, {} as never);
    await expect(
      plugin['tool.execute.before']!({ tool: 'bash', sessionID: 'sess-2', callID: 'c-2' }, { args: { command: 'git stash' } }),
    ).rejects.toThrow('Blocked: destructive command not permitted for agent "main"');
  });

  test("should rethrow 'Blocked:' errors and swallow/warn unexpected errors", async () => {
    const guardSpy = spyOn(beforeTool, 'guardAgainstDestructiveActions').mockImplementation(async () => {
      throw new Error('Unexpected database error');
    });
    const warnSpy = spyOn(console, 'warn').mockImplementation(NOOP);

    try {
      const plugin = await OwflowPlugin(mockPluginInput(workspace.directory));
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
