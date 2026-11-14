import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as hooksPersistenceModule from '../hooks/hooks-persistence.js';
import OwflowPlugin from '../index.js';
import { NOOP, mockPluginInput, mockWrapperConstructor } from './index-test-helpers.js';

const workspace = { directory: '' };

beforeEach(() => {
  workspace.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'owflow-index-hooks-test-'));
});

afterEach(() => {
  if (fs.existsSync(workspace.directory)) {
    fs.rmSync(workspace.directory, { recursive: true, force: true });
  }
});

describe('user hooks disabled mode', () => {
  test('should return only built-in hooks when OWFLOW_HOOKS_DISABLED=1', async () => {
    const environmentSpy = spyOn(process, 'env', 'get').mockReturnValue({
      OWFLOW_HOOKS_DISABLED: '1',
    } as NodeJS.ProcessEnv);
    const consoleLogSpy = spyOn(console, 'log').mockImplementation(NOOP);

    try {
      const plugin = await OwflowPlugin(mockPluginInput(workspace.directory));
      expect(plugin.tool).toBeDefined();
      expect(plugin.config).toBeDefined();
      expect(plugin['tool.execute.before']).toBeDefined();
      expect(plugin.event).toBeUndefined();
      expect(plugin.dispose).toBeUndefined();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('OWFLOW_HOOKS_DISABLED=1'));
    } finally {
      consoleLogSpy.mockRestore();
      environmentSpy.mockRestore();
    }
  });
});

describe('user hooks session abort integration', () => {
  test('should abort session via client when gate hook fails and warn on client abort error', async () => {
    const aborts: Array<{ path: { id: string } }> = [];
    const client = {
      session: {
        abort: async (options: { path: { id: string } }) => {
          aborts.push(options);
          if (options.path.id === 'sess-abort-err') throw new Error('Client network error');
        },
      },
    };

    const wrapperSpy = mockWrapperConstructor((_directory, endSession) => ({
      dispatch: async (_event: unknown, input: { sessionID?: string }) => {
        if (endSession && input.sessionID) await endSession(input.sessionID);
        throw new Error('Blocked: gate check failed');
      },
      snapshot: { entries: [] },
      dispose: NOOP,
      createDispatchHandlers: () => ({
        'tool.execute.before': async (input: { sessionID?: string }) => {
          if (endSession && input.sessionID) await endSession(input.sessionID);
          throw new Error('Blocked: gate check failed');
        },
      }),
    }));
    const warnSpy = spyOn(console, 'warn').mockImplementation(NOOP);

    try {
      const plugin = await OwflowPlugin(mockPluginInput(workspace.directory, client));
      await expect(
        plugin['tool.execute.before']!({ tool: 'bash', sessionID: 'sess-gate-fail', callID: 'c-1' }, { args: { command: 'ls' } }),
      ).rejects.toThrow('Blocked: gate check failed');

      expect(aborts).toEqual([{ path: { id: 'sess-gate-fail' } }]);

      await expect(
        plugin['tool.execute.before']!({ tool: 'bash', sessionID: 'sess-abort-err', callID: 'c-2' }, { args: { command: 'ls' } }),
      ).rejects.toThrow('Blocked: gate check failed');

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('failed to end session sess-abort-err'));
    } finally {
      wrapperSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});

describe('user hooks lifecycle integration', () => {
  test('should call user dispose and cleanup on dispose', async () => {
    let isWrapperDisposed = false;
    const wrapperSpy = mockWrapperConstructor(() => ({
      dispatch: async () => {},
      snapshot: { entries: [] },
      dispose: () => {
        isWrapperDisposed = true;
      },
      createDispatchHandlers: () => ({}),
    }));

    try {
      const plugin = await OwflowPlugin(mockPluginInput(workspace.directory));
      await plugin.dispose?.();
      expect(isWrapperDisposed).toBe(true);
    } finally {
      wrapperSpy.mockRestore();
    }
  });

  test('should maintain built-in destructive action guard and write crash log when user hooks fail initialization', async () => {
    const crashSpy = spyOn(hooksPersistenceModule, 'writeHookCrashLog').mockImplementation(NOOP);
    const wrapperSpy = mockWrapperConstructor(() => {
      throw new Error('SyntaxError in user hook script');
    });
    const errorSpy = spyOn(console, 'error').mockImplementation(NOOP);

    try {
      const plugin = await OwflowPlugin(mockPluginInput(workspace.directory));

      expect(crashSpy).toHaveBeenCalledWith(workspace.directory, 'startup_digest_failed', expect.any(Error));
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('user hooks failed to load'));
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('destructive command guard remains ACTIVE'));

      expect(plugin.tool).toBeDefined();
      expect(plugin['tool.execute.before']).toBeDefined();
      expect(plugin.event).toBeUndefined();

      await plugin['chat.message']!({ sessionID: 'sess-guard', agent: 'main' }, {} as never);
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
