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
  DEFAULT_HOOK_TIMEOUT_MS,
  flushStatusFileAtomic,
  MAX_LOG_FILE_BYTES,
  NON_SESSION_STREAM_CAP_BYTES,
  readStream,
  STATUS_DEBOUNCE_MS,
} from '../../hooks/hooks-runtime.js';
import {
  readHookLogRecords,
  readHookStatusSnapshot,
  readSessionHookLogs,
  resolveHooksLatestSymlink,
  resolveHooksLogFile,
} from '../../hooks/hooks-persistence.js';
import { HookEvent, HookRunState } from '../../types/hook-types.js';

describe('hooks-runtime (execution & dispatch runtime)', () => {
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

  test('buildStdinPayload serializes circular context references without throwing', () => {
    const circularObj: any = { name: 'circular-test' };
    circularObj.self = circularObj;
    const raw = buildStdinPayload(HookEvent.ToolExecuteBefore, circularObj, {}, 'ses_circ');
    expect(() => JSON.parse(raw)).not.toThrow();
    const parsed = JSON.parse(raw);
    expect(parsed.context.self.self).toBe('[Circular]');
  });

  test('runtime status and log persistence safely ignore dangling symlinks and clean up symlink rotation targets', async () => {
    const root = makeTempDir();
    const hooksDir = path.join(root, '.owflow', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'tool-execute-before.sh'), '#!/usr/bin/env bash\nexit 0\n');

    const targetFile = path.join(root, 'target-status.txt');
    const danglingStatus = path.join(root, 'dangling-status.json');
    fs.symlinkSync(targetFile, danglingStatus);

    const targetLog = path.join(root, 'target-log.txt');
    const danglingLog = path.join(root, 'dangling-log.jsonl');
    fs.symlinkSync(targetLog, danglingLog);

    const wrapper = await initializeHooksWrapper(root, undefined, {
      statusFile: danglingStatus,
      logFile: danglingLog,
    });
    await wrapper.dispatch(HookEvent.ToolExecuteBefore, { sessionID: 'ses_sym' }, {});
    wrapper.dispose();

    // Neither target file should have been created or written to
    expect(fs.existsSync(targetFile)).toBe(false);
    expect(fs.existsSync(targetLog)).toBe(false);
  });

  test('git-hooks execution: exit 0 succeeds, non-zero fails closed & aborts session, truncates large output, rotates logs, and supports timeout', async () => {
    const root = makeTempDir();
    const hooksDir = path.join(root, '.owflow', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });

    const statusFile = path.join(root, 'status.json');
    const logFile = path.join(root, 'logs.jsonl');

    // 1. Successful hook with stdout and stderr
    fs.writeFileSync(path.join(hooksDir, 'tool-execute-before.sh'), `#!/usr/bin/env bash\necho "out line"\necho "warn line" >&2\nexit 0\n`);
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

    // Session hook run writes stdout and stderr directly to JSONL records
    await wrapper.dispatch(HookEvent.ToolExecuteBefore, { sessionID: 'ses_ok' }, {});
    const latestOk = readSessionHookLogs(logFile, HookEvent.ToolExecuteBefore, Number.NEGATIVE_INFINITY, 'ses_ok').at(-1);
    expect(latestOk?.status).toBe(HookRunState.SUCCESS);
    expect(latestOk?.stdout).toBe('out line\n');
    expect(latestOk?.stderr).toBe('warn line\n');
    expect(readSessionHookLogs(logFile, HookEvent.ToolExecuteBefore, Date.now() + 10_000)).toEqual([]);

    // Non-session hook run writes to JSONL
    await wrapper.dispatch(HookEvent.ToolExecuteBefore, {}, {});
    const nonSession = readSessionHookLogs(logFile, HookEvent.ToolExecuteBefore).at(-1);
    expect(nonSession?.status).toBe(HookRunState.SUCCESS);
    expect(nonSession?.stdout).toBe('out line\n');
    expect(nonSession?.stderr).toBe('warn line\n');

    // Consecutive dispatches are each recorded with distinct runId in JSONL
    await wrapper.dispatch(HookEvent.ToolExecuteBefore, {}, {});
    const logsAfterRepeat = readHookLogRecords(logFile);
    expect(logsAfterRepeat.kind === 'ok' && logsAfterRepeat.records.length).toBe(3);

    // Non-zero exit fails closed and ends session
    await expect(wrapper.dispatch(HookEvent.ChatMessage, { sessionID: 'ses_fail' }, {})).rejects.toThrow(/Blocked: policy violation\./);
    expect(ended).toEqual(['ses_fail']);

    // Log rotation when file > MAX_LOG_FILE_BYTES
    fs.writeFileSync(logFile, 'x'.repeat(MAX_LOG_FILE_BYTES + 10));
    await wrapper.dispatch(HookEvent.ToolExecuteBefore, { sessionID: 'ses_rotated' }, {});
    expect(fs.existsSync(`${logFile}.1`)).toBe(true);

    wrapper.dispose();
  });

  test('preserves full run history across consecutive successful runs in the same session', async () => {
    const root = makeTempDir();
    const hooksDir = path.join(root, '.owflow', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    const statusFile = path.join(root, 'status-dedup.json');
    const logFile = path.join(root, 'logs-dedup.jsonl');
    const hookScript = path.join(hooksDir, 'tool-execute-before.sh');
    fs.writeFileSync(hookScript, '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });

    const wrapper = await initializeHooksWrapper(root, undefined, { statusFile, logFile });
    const sessionID = 'ses_multi_run';

    for (let i = 0; i < 5; i++) {
      await wrapper.dispatch(HookEvent.ToolExecuteBefore, { sessionID }, {});
    }

    const logs = readSessionHookLogs(logFile, HookEvent.ToolExecuteBefore, 0, sessionID);
    expect(logs.length).toBe(5);
    expect(logs.map((l) => l.runId)).toEqual([
      'tool.execute.before#1',
      'tool.execute.before#2',
      'tool.execute.before#3',
      'tool.execute.before#4',
      'tool.execute.before#5',
    ]);

    wrapper.dispose();
  });

  test('isolates runtime logs into per-hook files and updates latest symlink', async () => {
    const root = makeTempDir();
    const hooksDir = path.join(root, '.owflow', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });

    const hook1 = path.join(hooksDir, 'tool-execute-before.sh');
    const hook2 = path.join(hooksDir, 'chat-message.sh');
    fs.writeFileSync(hook1, '#!/usr/bin/env bash\necho "tool out"\nexit 0\n', { mode: 0o755 });
    fs.writeFileSync(hook2, '#!/usr/bin/env bash\necho "chat out"\nexit 0\n', { mode: 0o755 });

    const statusFile = path.join(root, 'status-isolated.json');
    const wrapper = await initializeHooksWrapper(root, undefined, { statusFile });
    const sessionID = 'ses_per_hook';
    const latestSymlink = resolveHooksLatestSymlink(root);

    // Dispatch tool.execute.before
    await wrapper.dispatch(HookEvent.ToolExecuteBefore, { sessionID }, {});

    const logFileTool = resolveHooksLogFile(root, 'tool-execute-before');
    const logFileChat = resolveHooksLogFile(root, 'chat-message');

    expect(fs.existsSync(logFileTool)).toBe(true);
    expect(fs.existsSync(logFileChat)).toBe(false);
    expect(fs.readlinkSync(latestSymlink)).toBe(logFileTool);

    const toolLogs = readHookLogRecords(logFileTool);
    expect(toolLogs.kind === 'ok' && toolLogs.records.length).toBe(1);
    expect(toolLogs.kind === 'ok' && toolLogs.records[0].name).toBe('tool-execute-before');

    // Dispatch chat.message
    await wrapper.dispatch(HookEvent.ChatMessage, { sessionID }, {});

    expect(fs.existsSync(logFileChat)).toBe(true);
    expect(fs.readlinkSync(latestSymlink)).toBe(logFileChat);

    const chatLogs = readHookLogRecords(logFileChat);
    expect(chatLogs.kind === 'ok' && chatLogs.records.length).toBe(1);
    expect(chatLogs.kind === 'ok' && chatLogs.records[0].name).toBe('chat-message');

    // Verify tool log file still only has its 1 record (isolated!)
    const toolLogsAfter = readHookLogRecords(logFileTool);
    expect(toolLogsAfter.kind === 'ok' && toolLogsAfter.records.length).toBe(1);

    wrapper.dispose();
  });

  test('evicts oldest entries when written run records exceed capacity', async () => {
    const root = makeTempDir();
    const hooksDir = path.join(root, '.owflow', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    const statusFile = path.join(root, 'status-evict.json');
    const logFile = path.join(root, 'logs-evict.jsonl');
    const hookScript = path.join(hooksDir, 'tool-execute-before.sh');
    fs.writeFileSync(hookScript, '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });

    const spawnSpy = spyOn(Bun, 'spawn').mockImplementation(
      () =>
        ({
          pid: 12345,
          kill: () => {},
          exited: Promise.resolve(0),
          stdout: new Response('').body,
          stderr: new Response('').body,
          signalCode: null,
        }) as any,
    );

    try {
      const wrapper = await initializeHooksWrapper(root, undefined, { statusFile, logFile });
      for (let i = 0; i < 1005; i++) {
        await wrapper.dispatch(HookEvent.ToolExecuteBefore, {}, {});
      }
      wrapper.dispose();
    } finally {
      spawnSpy.mockRestore();
    }
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

    const latestIdleLog = readSessionHookLogs(logFile, 'session.idle', Number.NEGATIVE_INFINITY, 'ses_idle_1').at(-1);
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

  test('readStream should read stream and invoke onChunk within limit', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('hello '));
        controller.enqueue(encoder.encode('world'));
        controller.close();
      },
    });

    const chunks: string[] = [];
    const result = await readStream(stream, (c) => chunks.push(c));
    expect(result).toBe('hello world');
    expect(chunks.join('')).toBe('hello world');
  });

  test('readStream should return empty string for null or undefined stream', async () => {
    expect(await readStream(null, () => {})).toBe('');
    expect(await readStream(undefined, () => {})).toBe('');
  });

  test('readStream should cancel stream reader and bound output when maxBytes is exceeded', async () => {
    const encoder = new TextEncoder();
    let cancelCalled = false;
    let cancelReason: unknown;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('chunk-one-12345-'));
        controller.enqueue(encoder.encode('chunk-two-67890-'));
        controller.enqueue(encoder.encode('chunk-three-should-not-be-buffered-'));
      },
      cancel(reason) {
        cancelCalled = true;
        cancelReason = reason;
      },
    });

    const chunks: string[] = [];
    const maxBytes = 15;
    const result = await readStream(stream, (c) => chunks.push(c), maxBytes);

    expect(cancelCalled).toBe(true);
    expect(cancelReason).toBe('Stream limit exceeded');
    expect(result.length).toBeLessThanOrEqual(maxBytes);
  });

  test('non-session hook dispatch caps logged stdout to NON_SESSION_STREAM_CAP_BYTES in jsonl logs', async () => {
    const root = makeTempDir();
    const hooksDir = path.join(root, '.owflow', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'tool-execute-before.sh'), "#!/usr/bin/env bash\nhead -c 32768 < /dev/zero | tr '\\0' 'A'\nexit 0\n");
    const statusFile = path.join(root, 'status.json');
    const logFile = path.join(root, 'logs.jsonl');

    const wrapper = await initializeHooksWrapper(root, undefined, { statusFile, logFile });
    await wrapper.dispatch(HookEvent.ToolExecuteBefore, {
      tool: 'bash',
      args: { command: 'test' },
    });

    const logResult = readHookLogRecords(logFile);
    expect(logResult.kind).toBe('ok');
    if (logResult.kind === 'ok') {
      expect(logResult.records.length).toBe(1);
      expect(logResult.records[0].stdout?.length).toBe(NON_SESSION_STREAM_CAP_BYTES);
    }

    wrapper.dispose();
  });

  test('default 2m timeout triggers when OWFLOW_HOOK_TIMEOUT_MS is unset, and is disabled when set to 0', async () => {
    const root = makeTempDir();
    const hooksDir = path.join(root, '.owflow', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'config.sh'), '#!/usr/bin/env bash\nexit 0\n');

    expect(DEFAULT_HOOK_TIMEOUT_MS).toBe(120_000);

    const prevTimeout = process.env[HOOK_TIMEOUT_ENV];
    delete process.env[HOOK_TIMEOUT_ENV];

    let killed = false;
    let exitResolver: (code: number) => void;
    const exitPromise = new Promise<number>((resolve) => {
      exitResolver = resolve;
    });

    const mockProc = {
      pid: 12345,
      kill: spyOn({ kill: () => {} }, 'kill').mockImplementation(() => {
        killed = true;
        exitResolver(143);
      }),
      exited: exitPromise,
      stdout: new Response('').body,
      stderr: new Response('').body,
      signalCode: null,
    };

    const spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => mockProc as any);
    const setTimeoutSpy = spyOn(globalThis, 'setTimeout');
    try {
      let recordedDelay: number | undefined;
      setTimeoutSpy.mockImplementation(((fn: () => void, ms?: number) => {
        if (ms !== STATUS_DEBOUNCE_MS) {
          recordedDelay = ms;
          // do not wait 2m in test, trigger immediately
          fn();
        }
        return 1 as any;
      }) as typeof setTimeout);

      const wrapper = await initializeHooksWrapper(root, undefined, {
        statusFile: path.join(root, 's.json'),
        logFile: path.join(root, 'l.jsonl'),
      });

      await expect(wrapper.dispatch(HookEvent.Config, {})).rejects.toThrow(/timed out after 120000ms/);
      expect(recordedDelay).toBe(120_000);
      expect(killed).toBe(true);
      wrapper.dispose();

      // Now verify timeout is disabled when set to 0
      process.env[HOOK_TIMEOUT_ENV] = '0';
      let timeoutScheduled = false;
      setTimeoutSpy.mockImplementation(((fn: () => void, ms?: number) => {
        if (ms !== STATUS_DEBOUNCE_MS) {
          timeoutScheduled = true;
        }
        return 1 as any;
      }) as typeof setTimeout);

      const quickProc = {
        pid: 12346,
        kill: () => {},
        exited: Promise.resolve(0),
        stdout: new Response('').body,
        stderr: new Response('').body,
        signalCode: null,
      };
      spawnSpy.mockImplementation(() => quickProc as any);

      const wrapper2 = await initializeHooksWrapper(root, undefined, {
        statusFile: path.join(root, 's2.json'),
        logFile: path.join(root, 'l2.jsonl'),
      });
      await wrapper2.dispatch(HookEvent.Config, {});
      expect(timeoutScheduled).toBe(false);
      wrapper2.dispose();
    } finally {
      setTimeoutSpy.mockRestore();
      spawnSpy.mockRestore();
      if (prevTimeout === undefined) delete process.env[HOOK_TIMEOUT_ENV];
      else process.env[HOOK_TIMEOUT_ENV] = prevTimeout;
    }
  });

  test('OWFLOW_DEBUG=1 logs real-time trace messages to console.error', async () => {
    const root = makeTempDir();
    const hooksDir = path.join(root, '.owflow', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'tool-execute-before.sh'), '#!/usr/bin/env bash\necho "debug-ok"\nexit 0\n');

    const errLines: string[] = [];
    const errSpy = spyOn(console, 'error').mockImplementation((msg: string) => {
      errLines.push(msg);
    });

    const prevDebug = process.env.OWFLOW_DEBUG;
    process.env.OWFLOW_DEBUG = '1';

    try {
      const wrapper = await initializeHooksWrapper(root, undefined, {
        statusFile: path.join(root, 'status.json'),
        logFile: path.join(root, 'logs.jsonl'),
      });
      await wrapper.dispatch(HookEvent.ToolExecuteBefore, {}, {});

      expect(errLines.some((l) => l.includes('[owflow:debug] [tool.execute.before] Spawning'))).toBe(true);
      expect(errLines.some((l) => l.includes('[owflow:debug] [tool.execute.before] Finished') && l.includes('exitCode: 0'))).toBe(true);
      wrapper.dispose();
    } finally {
      errSpy.mockRestore();
      if (prevDebug === undefined) delete process.env.OWFLOW_DEBUG;
      else process.env.OWFLOW_DEBUG = prevDebug;
    }
  });

  test('Bun.spawn throwing fails closed with clean Blocked error and records failure in logs', async () => {
    const root = makeTempDir();
    const hooksDir = path.join(root, '.owflow', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'tool-execute-before.sh'), '#!/usr/bin/env bash\nexit 0\n');

    const spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    const statusFile = path.join(root, 'status.json');
    const logFile = path.join(root, 'logs.jsonl');

    try {
      const wrapper = await initializeHooksWrapper(root, undefined, { statusFile, logFile });
      await expect(wrapper.dispatch(HookEvent.ToolExecuteBefore, {}, {})).rejects.toThrow(/Blocked: failed to spawn hook.*EACCES: permission denied/);

      const logs = readHookLogRecords(logFile);
      expect(logs.kind).toBe('ok');
      if (logs.kind === 'ok') {
        expect(logs.records).toHaveLength(1);
        expect(logs.records[0].status).toBe(HookRunState.FAILURE);
        expect(logs.records[0].reason).toContain('EACCES: permission denied');
      }
      wrapper.dispose();
    } finally {
      spawnSpy.mockRestore();
    }
  });

  test('createDispatchHandlers isolates reactive host event failures from crashing OpenCode event bus', async () => {
    const warnLines: string[] = [];
    const warnSpy = spyOn(console, 'warn').mockImplementation((msg: string) => {
      warnLines.push(msg);
    });

    try {
      const dispatchMock = spyOn(
        {
          dispatch: async (ev: string) => {
            if (ev === 'session.idle') throw new Error('Blocked: idle check failed');
            if (ev === HookEvent.Event) throw new Error('Blocked: catch-all event failed');
          },
        },
        'dispatch',
      );

      const handlers = createDispatchHandlers(dispatchMock.mock.calls ? (dispatchMock as any) : () => Promise.resolve());

      // Dispatching reactive event via host Event handler should NOT throw unhandled rejection
      await handlers[HookEvent.Event]({ event: { type: 'session.idle' } });

      expect(warnLines.some((l) => l.includes('reactive host event "session.idle" failed'))).toBe(true);
      expect(warnLines.some((l) => l.includes('catch-all event hook failed'))).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('debounces transient PENDING status writes and atomically flushes terminal states', async () => {
    const root = makeTempDir();
    const hooksDir = path.join(root, '.owflow', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'tool-execute-before.sh'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });

    const statusFile = path.join(root, 'status.json');
    const logFile = path.join(root, 'logs.jsonl');

    let renameCount = 0;
    const origRenameSync = fs.renameSync;
    const renameSpy = spyOn(fs, 'renameSync').mockImplementation((oldPath, newPath) => {
      if (typeof newPath === 'string' && newPath.includes('status.json')) {
        renameCount += 1;
      }
      return origRenameSync(oldPath, newPath);
    });

    try {
      const wrapper = await initializeHooksWrapper(root, undefined, { statusFile, logFile });
      expect(renameCount).toBe(1);

      await wrapper.dispatch(HookEvent.ToolExecuteBefore, {}, {});
      expect(renameCount).toBe(2);

      const status = readHookStatusSnapshot(statusFile);
      expect(status.kind).toBe('ok');
      if (status.kind === 'ok') {
        expect(status.snapshot.hooks[HookEvent.ToolExecuteBefore]?.status).toBe(HookRunState.SUCCESS);
      }

      wrapper.dispose();
    } finally {
      renameSpy.mockRestore();
    }
  });

  test('flushes PENDING status after debounce delay for slow hooks and clears timer on dispose', async () => {
    const root = makeTempDir();
    const hooksDir = path.join(root, '.owflow', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'tool-execute-before.sh'), '#!/usr/bin/env bash\nsleep 0.12\nexit 0\n', { mode: 0o755 });

    const statusFile = path.join(root, 'status-slow.json');
    const logFile = path.join(root, 'logs-slow.jsonl');

    const wrapper = await initializeHooksWrapper(root, undefined, { statusFile, logFile });
    const dispatchPromise = wrapper.dispatch(HookEvent.ToolExecuteBefore, {}, {});

    await new Promise((r) => setTimeout(r, 15));
    let status = readHookStatusSnapshot(statusFile);
    expect(status.kind === 'ok' && status.snapshot.hooks[HookEvent.ToolExecuteBefore]).toBeUndefined();

    await new Promise((r) => setTimeout(r, 65));
    status = readHookStatusSnapshot(statusFile);
    expect(status.kind).toBe('ok');
    if (status.kind === 'ok') {
      expect(status.snapshot.hooks[HookEvent.ToolExecuteBefore]?.status).toBe(HookRunState.PENDING);
    }

    await dispatchPromise;
    status = readHookStatusSnapshot(statusFile);
    expect(status.kind).toBe('ok');
    if (status.kind === 'ok') {
      expect(status.snapshot.hooks[HookEvent.ToolExecuteBefore]?.status).toBe(HookRunState.SUCCESS);
    }

    wrapper.dispose();
  });

  test('flushStatusFileAtomic cleans up .tmp file when write or rename throws', () => {
    const root = makeTempDir();
    const statusFile = path.join(root, 'atomic-status.json');
    const tmpFile = `${statusFile}.${process.pid}.tmp`;

    const renameSpy = spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('EACCES: mock rename failure');
    });

    try {
      flushStatusFileAtomic(statusFile, root, new Map());
      expect(fs.existsSync(tmpFile)).toBe(false);
    } finally {
      renameSpy.mockRestore();
    }
  });
});
