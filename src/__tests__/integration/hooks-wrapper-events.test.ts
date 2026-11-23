import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import HooksWrapper from '../../hooks/hooks-wrapper.js';
import { readSessionHookLogs } from '../../hooks/hooks-persistence.js';
import * as hooksPersistenceModule from '../../hooks/hooks-persistence.js';
import { HookEventName, HookRunState, HostEventName } from '../../types/hook-types.js';
import { EXECUTABLE_MODE } from '../fixtures/hooks/hooks-wrapper-fixtures.js';
import { removeScratchDirectory } from '../fixtures/hooks/scratch-cleanup.js';

type HostHandler = (input: unknown, output?: Record<string, unknown>) => Promise<void>;

const CIRCUIT_FAILURE_COUNT = 4;
const NULL_VALUE: null = JSON.parse('null');
const SCRATCH_ROOT = path.join(process.cwd(), '.test-scratch', 'hooks-wrapper-events');

const asHostHandler = (handler: unknown): HostHandler => handler as unknown as HostHandler;

fs.rmSync(SCRATCH_ROOT, { recursive: true, force: true });
fs.mkdirSync(SCRATCH_ROOT, { recursive: true });

afterAll(() => {
  removeScratchDirectory(SCRATCH_ROOT);
});

describe('hooks-wrapper (host event handling)', () => {
  test('createHostEventHandlers drops duplicate in-flight session.idle host events', async () => {
    const root = path.join(SCRATCH_ROOT, 'idle-dedupe');
    const wrapper = new HooksWrapper(root);
    const events: string[] = [];
    const { promise: idleBarrier, resolve: releaseIdle } = Promise.withResolvers<void>();

    spyOn(wrapper, 'runHook').mockImplementation(async (options) => {
      events.push(options.event);
      if (options.event === HostEventName.SessionIdle) {
        await idleBarrier;
      }
    });

    const handlers = wrapper.createHostEventHandlers();
    const eventHandler = asHostHandler(handlers.event);

    const first = eventHandler({ event: { type: HostEventName.SessionIdle } });
    // Emit two duplicate session.idle events while the first is still in-flight
    const second = eventHandler({ event: { type: HostEventName.SessionIdle } });
    const third = eventHandler({ event: { type: HostEventName.SessionIdle } });

    releaseIdle();
    await Promise.all([first, second, third]);

    // Only one session.idle run executed; duplicates while in-flight were dropped
    expect(events.filter((eventName) => eventName === HostEventName.SessionIdle)).toEqual([HostEventName.SessionIdle]);
    wrapper.dispose();
  });

  test('createHostEventHandlers fans out catch-all event runs for each host event', async () => {
    const root = path.join(SCRATCH_ROOT, 'catch-all-fanout');
    const wrapper = new HooksWrapper(root);
    const events: string[] = [];
    spyOn(wrapper, 'runHook').mockImplementation(async (options) => {
      events.push(options.event);
    });

    const handlers = wrapper.createHostEventHandlers();
    const eventHandler = asHostHandler(handlers.event);

    await eventHandler({ event: { type: HostEventName.SessionIdle } });
    await eventHandler({ event: { type: HostEventName.SessionIdle } });
    await eventHandler({ event: { type: HostEventName.SessionIdle } });

    expect(events.filter((eventName) => eventName === 'event')).toEqual(['event', 'event', 'event']);
    wrapper.dispose();
  });
});

describe('hooks-wrapper (host event isolation)', () => {
  test('createHostEventHandlers isolates reactive host event failures from crashing OpenCode event bus without leaking to console', async () => {
    const root = path.join(SCRATCH_ROOT, 'event-isolation');
    const wrapper = new HooksWrapper(root);
    const crashEvents: Array<{ source: string; error: unknown }> = [];
    const crashSpy = spyOn(hooksPersistenceModule, 'writeHookCrashLog').mockImplementation((options) => {
      crashEvents.push({ source: options.source, error: options.error });
    });
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    try {
      spyOn(wrapper, 'runHook').mockImplementation(async (options) => {
        if (options.event === HostEventName.SessionIdle) throw new Error('Blocked: idle check failed');
        if (options.event === HookEventName.Event) throw new Error('Blocked: catch-all event failed');
      });

      const handlers = wrapper.createHostEventHandlers();
      const eventHandler = asHostHandler(handlers[HookEventName.Event]);

      // Running reactive event via host Event handler should NOT throw unhandled rejection
      await eventHandler({ event: { type: HostEventName.SessionIdle } });

      // Does not leak to console.warn / terminal in the working TUI
      expect(warnSpy).not.toHaveBeenCalled();
      // Records failures to persistent crash log instead
      expect(crashEvents.some((crashEvent) => crashEvent.source === 'reactive_host_event_session.idle')).toBe(true);
      expect(crashEvents.some((crashEvent) => crashEvent.source === 'catch_all_event_hook')).toBe(true);
    } finally {
      crashSpy.mockRestore();
      warnSpy.mockRestore();
      wrapper.dispose();
    }
  });

  test('createHostEventHandlers routes passthrough lifecycle events to runHook', async () => {
    const root = path.join(SCRATCH_ROOT, 'passthrough-routing');
    const wrapper = new HooksWrapper(root);
    const routedEvents: string[] = [];
    spyOn(wrapper, 'runHook').mockImplementation(async (options) => {
      routedEvents.push(options.event);
    });

    const handlers = wrapper.createHostEventHandlers();
    const commandHandler = asHostHandler(handlers[HookEventName.CommandExecuteBefore]);
    const toolHandler = asHostHandler(handlers[HookEventName.ToolExecuteAfter]);
    await commandHandler({ command: 'ls' }, {});
    await toolHandler({ tool: 'bash' }, {});

    expect(routedEvents).toEqual([HookEventName.CommandExecuteBefore, HookEventName.ToolExecuteAfter]);
    wrapper.dispose();
  });
});

describe('hooks-wrapper (session end gating)', () => {
  test('does not call endSession when session.idle fails', async () => {
    const root = path.join(SCRATCH_ROOT, 'idle-gate');
    const hooksDirectory = path.join(root, '.owflow', 'hooks');
    fs.mkdirSync(hooksDirectory, { recursive: true });
    fs.writeFileSync(path.join(hooksDirectory, 'session-idle.sh'), '#!/usr/bin/env bash\necho "test failed" >&2\nexit 1\n', {
      mode: EXECUTABLE_MODE,
    });

    const ended: string[] = [];
    const wrapper = new HooksWrapper(root, {
      endSession: (sessionID) => {
        ended.push(sessionID);
      },
    });

    await expect(
      wrapper.runHook({
        event: HostEventName.SessionIdle,
        input: { event: { type: HostEventName.SessionIdle, properties: { sessionID: 'ses_idle_1' } } },
      }),
    ).rejects.toThrow(/Blocked: test failed\. Hint: fix the failing script .* \(failure recorded; fail closed\)/);

    expect(ended).toEqual([]);
    wrapper.dispose();
  });
});

describe('hooks-wrapper (session failure recording)', () => {
  test('records FAILURE status and log for a failed session.idle', async () => {
    const root = path.join(SCRATCH_ROOT, 'failure-recording');
    const hooksDirectory = path.join(root, '.owflow', 'hooks');
    fs.mkdirSync(hooksDirectory, { recursive: true });
    fs.writeFileSync(path.join(hooksDirectory, 'session-idle.sh'), '#!/usr/bin/env bash\necho "test failed" >&2\nexit 1\n', {
      mode: EXECUTABLE_MODE,
    });

    const statusFile = path.join(root, 'status.json');
    const logFile = path.join(root, 'logs.jsonl');
    const wrapper = new HooksWrapper(root, { statusFile, logFile });

    await expect(
      wrapper.runHook({
        event: HostEventName.SessionIdle,
        input: { event: { type: HostEventName.SessionIdle, properties: { sessionID: 'ses_idle_1' } } },
      }),
    ).rejects.toThrow(/Blocked: test failed\./);

    const snapshot = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    expect(snapshot.hooks[HostEventName.SessionIdle]?.status).toBe(HookRunState.FAILURE);
    expect(snapshot.hooks[HostEventName.SessionIdle]?.reason).toBe('test failed');

    const latestIdleLog = readSessionHookLogs({ file: logFile, event: HostEventName.SessionIdle, since: -Infinity, sessionID: 'ses_idle_1' }).at(-1);
    expect(latestIdleLog?.status).toBe(HookRunState.FAILURE);
    expect(latestIdleLog?.reason).toBe('test failed');
    wrapper.dispose();
  });
});

describe('hooks-wrapper (interpreter availability)', () => {
  test('does not call endSession when session.idle lacks an interpreter, while chat.message does', async () => {
    const root = path.join(SCRATCH_ROOT, 'interpreter-availability');
    const hooksDirectory = path.join(root, '.owflow', 'hooks');
    fs.mkdirSync(hooksDirectory, { recursive: true });
    fs.writeFileSync(path.join(hooksDirectory, 'session-idle.sh'), '#!/usr/bin/env bash\nexit 1\n', { mode: EXECUTABLE_MODE });
    fs.writeFileSync(path.join(hooksDirectory, 'chat-message.sh'), '#!/usr/bin/env bash\nexit 1\n', { mode: EXECUTABLE_MODE });

    const ended: string[] = [];
    const whichSpy = spyOn(Bun, 'which').mockReturnValue(NULL_VALUE);
    try {
      const wrapper = new HooksWrapper(root, {
        endSession: (sessionID) => {
          ended.push(sessionID);
        },
      });
      await expect(
        wrapper.runHook({
          event: HostEventName.SessionIdle,
          input: { event: { type: HostEventName.SessionIdle, properties: { sessionID: 'ses_idle_no_bash' } } },
        }),
      ).rejects.toThrow(/bash interpreter is not available/);
      expect(ended).toEqual([]);

      await expect(wrapper.runHook({ event: HookEventName.ChatMessage, input: { sessionID: 'ses_chat_no_bash' } })).rejects.toThrow(
        /bash interpreter is not available/,
      );
      expect(ended).toEqual(['ses_chat_no_bash']);
      wrapper.dispose();
    } finally {
      whichSpy.mockRestore();
    }
  });
});

describe('hooks-wrapper (session abort deduplication)', () => {
  test('deduplicates endSession calls per session within cooldown window and resets on chat.message', async () => {
    const root = path.join(SCRATCH_ROOT, 'abort-dedup');
    const hooksDirectory = path.join(root, '.owflow', 'hooks');
    fs.mkdirSync(hooksDirectory, { recursive: true });
    fs.writeFileSync(path.join(hooksDirectory, 'tool-execute-before.sh'), '#!/usr/bin/env bash\necho "tool gate failed" >&2\nexit 1\n', {
      mode: EXECUTABLE_MODE,
    });
    fs.writeFileSync(path.join(hooksDirectory, 'command-execute-before.sh'), '#!/usr/bin/env bash\necho "cmd gate failed" >&2\nexit 1\n', {
      mode: EXECUTABLE_MODE,
    });

    const ended: string[] = [];
    const wrapper = new HooksWrapper(root, {
      endSession: (sessionID) => {
        ended.push(sessionID);
      },
    });

    await expect(wrapper.runHook({ event: HookEventName.ToolExecuteBefore, input: { sessionID: 'ses_dedup' }, output: {} })).rejects.toThrow(
      /tool gate failed/,
    );
    await expect(wrapper.runHook({ event: HookEventName.CommandExecuteBefore, input: { sessionID: 'ses_dedup' }, output: {} })).rejects.toThrow(
      /cmd gate failed/,
    );
    expect(ended).toEqual(['ses_dedup']);

    // A new chat.message turn clears the session abort cooldown even when no chat-message hook exists
    await wrapper.runHook({ event: HookEventName.ChatMessage, input: { sessionID: 'ses_dedup' }, output: {} });
    await expect(wrapper.runHook({ event: HookEventName.ToolExecuteBefore, input: { sessionID: 'ses_dedup' }, output: {} })).rejects.toThrow(
      /tool gate failed/,
    );
    expect(ended).toEqual(['ses_dedup', 'ses_dedup']);

    wrapper.dispose();
  });
});

describe('hooks-wrapper (circuit breaker)', () => {
  test('should trip circuit breaker after 4 rapid consecutive failures and suppress spawns during cooldown', async () => {
    const root = path.join(SCRATCH_ROOT, 'circuit-breaker');
    fs.mkdirSync(path.join(root, '.owflow', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(root, '.owflow', 'hooks', 'session-idle.sh'), '#!/usr/bin/env bash\necho "check failed" >&2\nexit 1\n', {
      mode: EXECUTABLE_MODE,
    });

    const spawnSpy = spyOn(Bun, 'spawn');
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const wrapper = new HooksWrapper(root, { statusFile: path.join(root, 'status.json') });
      const payload = { event: { type: HostEventName.SessionIdle, properties: { sessionID: 'ses_cb' } } };

      for (let index = 0; index < CIRCUIT_FAILURE_COUNT; index += 1) {
        await expect(wrapper.runHook({ event: HostEventName.SessionIdle, input: payload })).rejects.toThrow(/Blocked: check failed\./);
      }

      expect(spawnSpy).toHaveBeenCalledTimes(CIRCUIT_FAILURE_COUNT);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('circuit breaker tripped'));

      // 5th rapid attempt is blocked before spawning a subprocess
      await expect(wrapper.runHook({ event: HostEventName.SessionIdle, input: payload })).rejects.toThrow(
        /Blocked: Circuit breaker active for .*session-idle\.sh/,
      );
      expect(spawnSpy).toHaveBeenCalledTimes(CIRCUIT_FAILURE_COUNT);

      const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'status.json'), 'utf8'));
      expect(snapshot.hooks[HostEventName.SessionIdle]?.status).toBe(HookRunState.FAILURE);
      expect(snapshot.hooks[HostEventName.SessionIdle]?.reason).toContain('Circuit breaker active');

      wrapper.dispose();
    } finally {
      spawnSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
