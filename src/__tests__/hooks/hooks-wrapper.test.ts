import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ABORT_COOLDOWN_MS,
  buildStdinPayload,
  canAbortSessionForEvent,
  CIRCUIT_BREAKER_COOLDOWN_MS,
  CIRCUIT_BREAKER_RAPID_GAP_MS,
  CIRCUIT_BREAKER_THRESHOLD,
  createDispatchHandlers,
  HOOK_TIMEOUT_ENV,
  initializeHooksWrapper,
  MAX_CAPTURE_BYTES,
  MAX_LOG_FILE_BYTES,
} from '../../hooks/hooks-wrapper.js';
import { readHookLogRecords, readLatestHookLog } from '../../hooks/hooks-logs.js';
import { HookEvent, HookRunState } from '../../types/hook-types.js';

describe('hooks-wrapper (runtime execution & dispatch wrapper)', () => {
  const tempDirs: string[] = [];

  const makeTempDir = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owflow-wrapper-unit-'));
    tempDirs.push(dir);
    return dir;
  };

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('buildStdinPayload strips class instance internals to identity keys and handles bigint', () => {
    class SecretModel {
      id = 'claude-4';
      providerID = 'anthropic';
      name = 'Claude';
      apiKey = 'sk-secret';
    }
    const raw = buildStdinPayload(
      HookEvent.ToolExecuteBefore,
      { tool: 'bash', count: 42n, model: new SecretModel() },
      { args: { command: 'ls' } },
      'ses_1',
    );
    expect(raw).not.toContain('sk-secret');
    expect(JSON.parse(raw)).toEqual({
      event: 'tool.execute.before',
      session: { sessionID: 'ses_1' },
      context: {
        tool: 'bash',
        count: '42',
        model: { id: 'claude-4', providerID: 'anthropic', name: 'Claude' },
        args: { command: 'ls' },
      },
    });
  });

  test('git-hooks execution: exit 0 succeeds, non-zero fails closed & aborts session, truncates large output, rotates logs, and supports timeout', async () => {
    const root = makeTempDir();
    const hooksDir = path.join(root, '.owflow', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });

    const statusFile = path.join(root, 'status.json');
    const logFile = path.join(root, 'logs.jsonl');

    // 1. Successful hook with large stdout (> 16KB) and stderr
    fs.writeFileSync(
      path.join(hooksDir, 'tool-execute-before.sh'),
      `#!/usr/bin/env bash\nhead -c ${MAX_CAPTURE_BYTES + 100} < /dev/zero | tr '\\0' 'a'\necho "warn line" >&2\nexit 0\n`,
    );
    // 2. Failing hook (non-zero exit)
    fs.writeFileSync(path.join(hooksDir, 'chat-message.sh'), `#!/usr/bin/env bash\necho "policy violation" >&2\nexit 2\n`);

    const ended: string[] = [];
    const wrapper = await initializeHooksWrapper(
      root,
      (id) => {
        ended.push(id);
      },
      { statusFile, logFile },
    );

    // Session hook run is NOT truncated
    await wrapper.dispatch(HookEvent.ToolExecuteBefore, { sessionID: 'ses_ok' }, {});
    const latestOk = readLatestHookLog(logFile, HookEvent.ToolExecuteBefore, Number.NEGATIVE_INFINITY, 'ses_ok');
    expect(latestOk?.status).toBe(HookRunState.SUCCESS);
    expect(latestOk?.truncated).toBeUndefined();
    expect(latestOk?.stdout?.length).toBeGreaterThan(MAX_CAPTURE_BYTES);
    expect(latestOk?.stderr).toBe('warn line\n');
    expect(readLatestHookLog(logFile, HookEvent.ToolExecuteBefore, Date.now() + 10_000)).toBeUndefined();

    // Non-session hook run caps at MAX_CAPTURE_BYTES and is marked truncated
    await wrapper.dispatch(HookEvent.ToolExecuteBefore, {}, {});
    const nonSession = readLatestHookLog(logFile, HookEvent.ToolExecuteBefore);
    expect(nonSession?.status).toBe(HookRunState.SUCCESS);
    expect(nonSession?.truncated).toBe(true);

    // Coalescing identical consecutive run does not duplicate JSONL line
    await wrapper.dispatch(HookEvent.ToolExecuteBefore, {}, {});
    const logsAfterRepeat = readHookLogRecords(logFile);
    expect(logsAfterRepeat.kind === 'ok' && logsAfterRepeat.records.length).toBe(2);

    // Non-zero exit fails closed and ends session
    await expect(wrapper.dispatch(HookEvent.ChatMessage, { sessionID: 'ses_fail' }, {})).rejects.toThrow(/Blocked: policy violation\./);
    expect(ended).toEqual(['ses_fail']);

    // Log rotation when file > MAX_LOG_FILE_BYTES
    fs.writeFileSync(logFile, 'x'.repeat(MAX_LOG_FILE_BYTES + 10));
    await wrapper.dispatch(HookEvent.ToolExecuteBefore, { sessionID: 'ses_rotated' }, {});
    expect(fs.existsSync(`${logFile}.1`)).toBe(true);

    wrapper.dispose();
  });

  test('timeout and missing interpreter fail closed', async () => {
    const root = makeTempDir();
    const hooksDir = path.join(root, '.owflow', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'config.sh'), '#!/usr/bin/env bash\nexit 0\n');

    let exitResolver: (code: number) => void;
    const exitPromise = new Promise<number>((resolve) => {
      exitResolver = resolve;
    });

    const mockProc = {
      pid: 12345,
      kill: spyOn({ kill: () => {} }, 'kill').mockImplementation(() => {
        exitResolver(143);
      }),
      exited: exitPromise,
      stdout: new Response('').body,
      stderr: new Response('').body,
      signalCode: null,
    };

    const spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => mockProc as any);
    const prevTimeout = process.env[HOOK_TIMEOUT_ENV];
    process.env[HOOK_TIMEOUT_ENV] = '20';
    const keepAlive = setInterval(() => {}, 5);
    try {
      const wrapper = await initializeHooksWrapper(root, undefined, {
        statusFile: path.join(root, 's.json'),
        logFile: path.join(root, 'l.jsonl'),
      });
      await expect(wrapper.dispatch(HookEvent.Config, {})).rejects.toThrow(/timed out after 20ms/);
      expect(mockProc.kill).toHaveBeenCalled();
      wrapper.dispose();
    } finally {
      clearInterval(keepAlive);
      spawnSpy.mockRestore();
      if (prevTimeout === undefined) delete process.env[HOOK_TIMEOUT_ENV];
      else process.env[HOOK_TIMEOUT_ENV] = prevTimeout;
    }

    // Missing interpreter branch
    const whichSpy = spyOn(Bun, 'which').mockReturnValue(null);
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const wrapper = await initializeHooksWrapper(
        root,
        () => {
          throw new Error('abort failed');
        },
        {
          statusFile: path.join(root, 's2.json'),
          logFile: path.join(root, 'l2.jsonl'),
        },
      );
      await expect(wrapper.dispatch(HookEvent.Config, { sessionID: 'ses_no_interp' })).rejects.toThrow(/bash interpreter is not available/);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      whichSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  test('silent successful event runs leave no status or log trace', async () => {
    const root = makeTempDir();
    const hooksDir = path.join(root, '.owflow', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'event.sh'), '#!/usr/bin/env bash\nexit 0\n');

    const statusFile = path.join(root, 'status.json');
    const logFile = path.join(root, 'logs.jsonl');

    const wrapper = await initializeHooksWrapper(root, undefined, { statusFile, logFile });
    await wrapper.dispatch(HookEvent.Event, {});

    const logResult = readHookLogRecords(logFile);
    expect(logResult).toEqual({ kind: 'missing' });
    wrapper.dispose();
  });

  test('dispose kills active running processes', async () => {
    const root = makeTempDir();
    const hooksDir = path.join(root, '.owflow', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'config.sh'), '#!/usr/bin/env bash\nexit 0\n');

    let exitResolver: (code: number) => void;
    const exitPromise = new Promise<number>((resolve) => {
      exitResolver = resolve;
    });

    const mockProc = {
      pid: 12345,
      kill: spyOn({ kill: () => {} }, 'kill').mockImplementation(() => {
        mockProc.signalCode = 'SIGTERM';
        exitResolver(143);
      }),
      exited: exitPromise,
      stdout: new Response('').body,
      stderr: new Response('').body,
      signalCode: null as string | null,
    };

    const spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => mockProc as any);
    try {
      const wrapper = await initializeHooksWrapper(root, undefined, {
        statusFile: path.join(root, 'status.json'),
        logFile: path.join(root, 'logs.jsonl'),
      });
      const dispatchPromise = wrapper.dispatch(HookEvent.Config, {});
      expect(mockProc.kill).not.toHaveBeenCalled();

      wrapper.dispose();
      expect(mockProc.kill).toHaveBeenCalledTimes(1);

      await expect(dispatchPromise).rejects.toThrow(/process terminated by signal SIGTERM/);

      // Subsequent dispose calls are safe and do not re-kill
      wrapper.dispose();
      expect(mockProc.kill).toHaveBeenCalledTimes(1);
    } finally {
      spawnSpy.mockRestore();
    }
  });

  test('createDispatchHandlers fans out host events, serializes catch-all event runs, and drops duplicate in-flight host events', async () => {
    const events: string[] = [];
    let releaseIdle!: () => void;
    const idleBarrier = new Promise<void>((resolve) => {
      releaseIdle = resolve;
    });

    const handlers = createDispatchHandlers(async (event) => {
      events.push(event);
      if (event === 'session.idle') {
        await idleBarrier;
      }
    });

    const first = handlers.event!({ event: { type: 'session.idle' } } as any);
    // Emit two duplicate session.idle events while the first is still in-flight
    const second = handlers.event!({ event: { type: 'session.idle' } } as any);
    const third = handlers.event!({ event: { type: 'session.idle' } } as any);

    releaseIdle();
    await Promise.all([first, second, third]);

    // Only one session.idle dispatch ran; duplicates while in-flight were dropped
    expect(events.filter((e) => e === 'session.idle')).toEqual(['session.idle']);
    expect(events.filter((e) => e === 'event')).toEqual(['event', 'event', 'event']);
  });

  test('should only allow session abort for active lifecycle gate events, not reactive host events or catch-all event', () => {
    expect(canAbortSessionForEvent(HookEvent.ToolExecuteBefore)).toBe(true);
    expect(canAbortSessionForEvent(HookEvent.ChatMessage)).toBe(true);
    expect(canAbortSessionForEvent(HookEvent.CommandExecuteBefore)).toBe(true);
    expect(canAbortSessionForEvent(HookEvent.Config)).toBe(true);

    expect(canAbortSessionForEvent('session.idle')).toBe(false);
    expect(canAbortSessionForEvent('session.status')).toBe(false);
    expect(canAbortSessionForEvent('session.error')).toBe(false);
    expect(canAbortSessionForEvent('file.edited')).toBe(false);
    expect(canAbortSessionForEvent(HookEvent.Event)).toBe(false);
  });

  test('should not call endSession when session.idle fails or lacks an interpreter', async () => {
    const root = makeTempDir();
    const hooksDir = path.join(root, '.owflow', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'session-idle.sh'), '#!/usr/bin/env bash\necho "test failed" >&2\nexit 1\n');
    fs.writeFileSync(path.join(hooksDir, 'chat-message.sh'), '#!/usr/bin/env bash\necho "gate failed" >&2\nexit 1\n');

    const statusFile = path.join(root, 'status.json');
    const logFile = path.join(root, 'logs.jsonl');
    const ended: string[] = [];

    const wrapper = await initializeHooksWrapper(
      root,
      (id) => {
        ended.push(id);
      },
      { statusFile, logFile },
    );

    await expect(wrapper.dispatch('session.idle', { event: { type: 'session.idle', properties: { sessionID: 'ses_idle_1' } } })).rejects.toThrow(
      /Blocked: test failed\. Hint: fix the failing script .* \(failure recorded; fail closed\)/,
    );

    expect(ended).toEqual([]);
    const snapshot = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    expect(snapshot.hooks['session.idle']?.status).toBe(HookRunState.FAILURE);
    expect(snapshot.hooks['session.idle']?.reason).toBe('test failed');

    const latestIdleLog = readLatestHookLog(logFile, 'session.idle', Number.NEGATIVE_INFINITY, 'ses_idle_1');
    expect(latestIdleLog?.status).toBe(HookRunState.FAILURE);
    expect(latestIdleLog?.reason).toBe('test failed');
    wrapper.dispose();

    // Missing interpreter on session.idle does not call endSession, while chat.message does
    const whichSpy = spyOn(Bun, 'which').mockReturnValue(null);
    try {
      const noInterpWrapper = await initializeHooksWrapper(
        root,
        (id) => {
          ended.push(id);
        },
        {
          statusFile: path.join(root, 'status-no-interp.json'),
          logFile: path.join(root, 'logs-no-interp.jsonl'),
        },
      );

      await expect(
        noInterpWrapper.dispatch('session.idle', { event: { type: 'session.idle', properties: { sessionID: 'ses_idle_no_bash' } } }),
      ).rejects.toThrow(/bash interpreter is not available/);
      expect(ended).toEqual([]);

      await expect(noInterpWrapper.dispatch(HookEvent.ChatMessage, { sessionID: 'ses_chat_no_bash' })).rejects.toThrow(
        /bash interpreter is not available/,
      );
      expect(ended).toEqual(['ses_chat_no_bash']);
      noInterpWrapper.dispose();
    } finally {
      whichSpy.mockRestore();
    }
  });

  test('should deduplicate endSession calls per session within cooldown window and reset on chat.message', async () => {
    expect(ABORT_COOLDOWN_MS).toBe(2_000);
    const root = makeTempDir();
    const hooksDir = path.join(root, '.owflow', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'tool-execute-before.sh'), '#!/usr/bin/env bash\necho "tool gate failed" >&2\nexit 1\n');
    fs.writeFileSync(path.join(hooksDir, 'command-execute-before.sh'), '#!/usr/bin/env bash\necho "cmd gate failed" >&2\nexit 1\n');

    const ended: string[] = [];
    const wrapper = await initializeHooksWrapper(
      root,
      (id) => {
        ended.push(id);
      },
      {
        statusFile: path.join(root, 'status.json'),
        logFile: path.join(root, 'logs.jsonl'),
      },
    );

    await expect(wrapper.dispatch(HookEvent.ToolExecuteBefore, { sessionID: 'ses_dedup' }, {})).rejects.toThrow(/tool gate failed/);
    await expect(wrapper.dispatch(HookEvent.CommandExecuteBefore, { sessionID: 'ses_dedup' }, {})).rejects.toThrow(/cmd gate failed/);
    expect(ended).toEqual(['ses_dedup']);

    // A new chat.message turn clears the session abort cooldown even when no chat-message hook exists
    await wrapper.dispatch(HookEvent.ChatMessage, { sessionID: 'ses_dedup' }, {});
    await expect(wrapper.dispatch(HookEvent.ToolExecuteBefore, { sessionID: 'ses_dedup' }, {})).rejects.toThrow(/tool gate failed/);
    expect(ended).toEqual(['ses_dedup', 'ses_dedup']);

    wrapper.dispose();
  });

  test('should trip circuit breaker after 4 rapid consecutive failures and suppress spawns during cooldown', async () => {
    expect(CIRCUIT_BREAKER_THRESHOLD).toBe(4);
    expect(CIRCUIT_BREAKER_RAPID_GAP_MS).toBe(500);
    expect(CIRCUIT_BREAKER_COOLDOWN_MS).toBe(30_000);

    const root = makeTempDir();
    const hooksDir = path.join(root, '.owflow', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'session-idle.sh'), '#!/usr/bin/env bash\necho "check failed" >&2\nexit 1\n');

    const statusFile = path.join(root, 'status.json');
    const logFile = path.join(root, 'logs.jsonl');
    const spawnSpy = spyOn(Bun, 'spawn');
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const wrapper = await initializeHooksWrapper(root, undefined, { statusFile, logFile });
      const payload = { event: { type: 'session.idle', properties: { sessionID: 'ses_cb' } } };

      for (let i = 0; i < CIRCUIT_BREAKER_THRESHOLD; i += 1) {
        await expect(wrapper.dispatch('session.idle', payload)).rejects.toThrow(/Blocked: check failed\./);
      }

      expect(spawnSpy).toHaveBeenCalledTimes(CIRCUIT_BREAKER_THRESHOLD);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('circuit breaker tripped'));

      // 5th rapid attempt is blocked before spawning a subprocess
      await expect(wrapper.dispatch('session.idle', payload)).rejects.toThrow(/Blocked: Circuit breaker active for .*session-idle\.sh/);
      expect(spawnSpy).toHaveBeenCalledTimes(CIRCUIT_BREAKER_THRESHOLD);

      const snapshot = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
      expect(snapshot.hooks['session.idle']?.status).toBe(HookRunState.FAILURE);
      expect(snapshot.hooks['session.idle']?.reason).toContain('Circuit breaker active');

      wrapper.dispose();
    } finally {
      spawnSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
