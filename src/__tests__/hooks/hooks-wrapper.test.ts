import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import HooksWrapper, {
  NON_SESSION_STREAM_CAP_BYTES,
  CircuitBreakerTracker,
  SessionAbortController,
  StatusRecorder,
  HookSpawnError,
  executeHookProcess,
  buildCircuitBreakerError,
  buildInterpreterUnavailableError,
  buildSpawnError,
  buildProcessFailureError,
} from '../../hooks/hooks-wrapper.js';
import { canAbortSessionForEvent } from '../../hooks/runtime/failure-policy.js';
import { DEFAULT_HOOK_TIMEOUT_MS, HOOK_TIMEOUT_ENV, buildExecutionArgs, readStream } from '../../hooks/runtime/process-executor.js';
import { STATUS_DEBOUNCE_MS } from '../../hooks/runtime/status-recorder.js';
import {
  readHookLogRecords,
  readHookStatusSnapshot,
  readSessionHookLogs,
  resolveHooksLatestSymlink,
  resolveHooksLogFile,
  writeHookCrashLog,
} from '../../hooks/hooks-persistence.js';
import * as hooksPersistenceModule from '../../hooks/hooks-persistence.js';
import { HookEvent, HookRunState, type HookRegistryEntry, type HookRunLogRecord } from '../../types/hook-types.js';

describe('hooks-wrapper (execution & dispatch runtime)', () => {
  const tempDirs: string[] = [];

  const makeTempDir = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owflow-wrapper-unit-'));
    tempDirs.push(dir);
    return dir;
  };

  const writeHook = (root: string, filename: string, content = '#!/usr/bin/env bash\nexit 0\n', mode = 0o755): string => {
    const hooksDir = path.join(root, '.owflow', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    const scriptPath = path.join(hooksDir, filename);
    fs.writeFileSync(scriptPath, content, { mode });
    return scriptPath;
  };

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('initializes snapshot of discovered hooks upon instantiation', () => {
    const root = makeTempDir();
    writeHook(root, 'tool-execute-before.sh');

    const wrapper = new HooksWrapper(root);
    expect(wrapper.snapshot.entries.length).toBe(1);
    expect(wrapper.snapshot.entries[0]!.event).toBe(HookEvent.ToolExecuteBefore);
    wrapper.dispose();
  });

  test('buildStdinPayload strips class instance internals to identity keys and handles bigint', () => {
    class SecretModel {
      id = 'claude-4';
      providerID = 'anthropic';
      name = 'Claude';
      apiKey = 'sk-secret';
    }
    const wrapper = new HooksWrapper(makeTempDir());
    const raw = (wrapper as any).buildStdinPayload(
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
    wrapper.dispose();
  });

  test('buildStdinPayload serializes circular context references without throwing', () => {
    const circularObj: any = { name: 'circular-test' };
    circularObj.self = circularObj;
    const wrapper = new HooksWrapper(makeTempDir());
    const raw = (wrapper as any).buildStdinPayload(HookEvent.ToolExecuteBefore, circularObj, {}, 'ses_circ');
    expect(() => JSON.parse(raw)).not.toThrow();
    const parsed = JSON.parse(raw);
    expect(parsed.context.self.self).toBe('[Circular]');
    wrapper.dispose();
  });

  test('runtime status and log persistence safely ignore dangling symlinks and clean up symlink rotation targets', async () => {
    const root = makeTempDir();
    writeHook(root, 'tool-execute-before.sh');

    const targetFile = path.join(root, 'target-status.txt');
    const danglingStatus = path.join(root, 'dangling-status.json');
    fs.symlinkSync(targetFile, danglingStatus);

    const targetLog = path.join(root, 'target-log.txt');
    const danglingLog = path.join(root, 'dangling-log.jsonl');
    fs.symlinkSync(targetLog, danglingLog);

    const wrapper = new HooksWrapper(root, undefined, {
      statusFile: danglingStatus,
      logFile: danglingLog,
    });
    await wrapper.dispatch(HookEvent.ToolExecuteBefore, { sessionID: 'ses_sym' }, {});
    wrapper.dispose();

    // Neither target file should have been created or written to
    expect(fs.existsSync(targetFile)).toBe(false);
    expect(fs.existsSync(targetLog)).toBe(false);
  });

  test('git-hooks execution: exit 0 succeeds and non-zero fails closed with session abort', async () => {
    const root = makeTempDir();
    const statusFile = path.join(root, 'status.json');
    const logFile = path.join(root, 'logs.jsonl');

    // 1. Successful hook with stdout and stderr
    writeHook(root, 'tool-execute-before.sh', `#!/usr/bin/env bash\necho "out line"\necho "warn line" >&2\nexit 0\n`);
    // 2. Failing hook (non-zero exit)
    writeHook(root, 'chat-message.sh', `#!/usr/bin/env bash\necho "policy violation" >&2\nexit 2\n`);

    const ended: string[] = [];
    const wrapper = new HooksWrapper(root, (id) => ended.push(id), { statusFile, logFile });

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

    wrapper.dispose();
  });

  test('preserves full run history across consecutive successful runs in the same session', async () => {
    const root = makeTempDir();
    const statusFile = path.join(root, 'status-dedup.json');
    const logFile = path.join(root, 'logs-dedup.jsonl');
    writeHook(root, 'tool-execute-before.sh');

    const wrapper = new HooksWrapper(root, undefined, { statusFile, logFile });
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
    writeHook(root, 'tool-execute-before.sh', '#!/usr/bin/env bash\necho "tool out"\nexit 0\n');
    writeHook(root, 'chat-message.sh', '#!/usr/bin/env bash\necho "chat out"\nexit 0\n');

    const statusFile = path.join(root, 'status-isolated.json');
    const wrapper = new HooksWrapper(root, undefined, { statusFile });
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
    expect(toolLogs.kind === 'ok' && toolLogs.records[0]!.name).toBe('tool-execute-before');

    // Dispatch chat.message
    await wrapper.dispatch(HookEvent.ChatMessage, { sessionID }, {});

    expect(fs.existsSync(logFileChat)).toBe(true);
    expect(fs.readlinkSync(latestSymlink)).toBe(logFileChat);

    const chatLogs = readHookLogRecords(logFileChat);
    expect(chatLogs.kind === 'ok' && chatLogs.records.length).toBe(1);
    expect(chatLogs.kind === 'ok' && chatLogs.records[0]!.name).toBe('chat-message');

    // Verify tool log file still only has its 1 record (isolated!)
    const toolLogsAfter = readHookLogRecords(logFileTool);
    expect(toolLogsAfter.kind === 'ok' && toolLogsAfter.records.length).toBe(1);

    wrapper.dispose();
  });

  test('missing interpreter fails closed and safely handles endSession callback errors', async () => {
    const root = makeTempDir();
    writeHook(root, 'config.sh');

    const whichSpy = spyOn(Bun, 'which').mockReturnValue(null);
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const wrapper = new HooksWrapper(root, () => {
        throw new Error('abort failed');
      });
      await expect(wrapper.dispatch(HookEvent.Config, { sessionID: 'ses_no_interp' })).rejects.toThrow(/bash interpreter is not available/);
      expect(warnSpy).toHaveBeenCalled();
      wrapper.dispose();
    } finally {
      whichSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  test('silent successful event runs leave no status or log trace', async () => {
    const root = makeTempDir();
    writeHook(root, 'event.sh');
    const logFile = path.join(root, 'logs.jsonl');

    const wrapper = new HooksWrapper(root, undefined, { logFile });
    await wrapper.dispatch(HookEvent.Event, {});

    expect(readHookLogRecords(logFile)).toEqual({ kind: 'missing' });
    wrapper.dispose();
  });

  test('dispose kills active running processes', async () => {
    const root = makeTempDir();
    writeHook(root, 'config.sh');

    let exitResolver: (code: number) => void;
    const exitPromise = new Promise<number>((r) => {
      exitResolver = r;
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
      const wrapper = new HooksWrapper(root);
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
    const root = makeTempDir();
    const wrapper = new HooksWrapper(root);
    const events: string[] = [];
    let releaseIdle!: () => void;
    const idleBarrier = new Promise<void>((resolve) => {
      releaseIdle = resolve;
    });

    spyOn(wrapper, 'dispatch').mockImplementation(async (event) => {
      events.push(event);
      if (event === 'session.idle') {
        await idleBarrier;
      }
    });

    const handlers = wrapper.createDispatchHandlers();

    const first = handlers.event!({ event: { type: 'session.idle' } } as any);
    // Emit two duplicate session.idle events while the first is still in-flight
    const second = handlers.event!({ event: { type: 'session.idle' } } as any);
    const third = handlers.event!({ event: { type: 'session.idle' } } as any);

    releaseIdle();
    await Promise.all([first, second, third]);

    // Only one session.idle dispatch ran; duplicates while in-flight were dropped
    expect(events.filter((e) => e === 'session.idle')).toEqual(['session.idle']);
    expect(events.filter((e) => e === 'event')).toEqual(['event', 'event', 'event']);
    wrapper.dispose();
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
    writeHook(root, 'session-idle.sh', '#!/usr/bin/env bash\necho "test failed" >&2\nexit 1\n');
    writeHook(root, 'chat-message.sh', '#!/usr/bin/env bash\necho "gate failed" >&2\nexit 1\n');

    const statusFile = path.join(root, 'status.json');
    const logFile = path.join(root, 'logs.jsonl');
    const ended: string[] = [];

    const wrapper = new HooksWrapper(root, (id) => ended.push(id), { statusFile, logFile });

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
      const noInterpWrapper = new HooksWrapper(root, (id) => ended.push(id));
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
    const root = makeTempDir();
    writeHook(root, 'tool-execute-before.sh', '#!/usr/bin/env bash\necho "tool gate failed" >&2\nexit 1\n');
    writeHook(root, 'command-execute-before.sh', '#!/usr/bin/env bash\necho "cmd gate failed" >&2\nexit 1\n');

    const ended: string[] = [];
    const wrapper = new HooksWrapper(root, (id) => ended.push(id));

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
    const root = makeTempDir();
    writeHook(root, 'session-idle.sh', '#!/usr/bin/env bash\necho "check failed" >&2\nexit 1\n');

    const statusFile = path.join(root, 'status.json');
    const spawnSpy = spyOn(Bun, 'spawn');
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const wrapper = new HooksWrapper(root, undefined, { statusFile });
      const payload = { event: { type: 'session.idle', properties: { sessionID: 'ses_cb' } } };

      for (let i = 0; i < 4; i += 1) {
        await expect(wrapper.dispatch('session.idle', payload)).rejects.toThrow(/Blocked: check failed\./);
      }

      expect(spawnSpy).toHaveBeenCalledTimes(4);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('circuit breaker tripped'));

      // 5th rapid attempt is blocked before spawning a subprocess
      await expect(wrapper.dispatch('session.idle', payload)).rejects.toThrow(/Blocked: Circuit breaker active for .*session-idle\.sh/);
      expect(spawnSpy).toHaveBeenCalledTimes(4);

      const snapshot = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
      expect(snapshot.hooks['session.idle']?.status).toBe(HookRunState.FAILURE);
      expect(snapshot.hooks['session.idle']?.reason).toContain('Circuit breaker active');

      wrapper.dispose();
    } finally {
      spawnSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  test('readStream reads stream within limit and handles null/undefined streams', async () => {
    expect(await readStream(null, () => {})).toBe('');
    expect(await readStream(undefined, () => {})).toBe('');

    const stream = new Response('hello world').body;
    const chunks: string[] = [];
    const result = await readStream(stream, (c) => chunks.push(c));
    expect(result).toBe('hello world');
    expect(chunks.join('')).toBe('hello world');
  });

  test('readStream should cancel stream reader and bound output when maxBytes is exceeded', async () => {
    let cancelCalled = false;
    let cancelReason: unknown;

    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('chunk-one-12345-chunk-two-67890-chunk-three-ignored'));
      },
      cancel(reason) {
        cancelCalled = true;
        cancelReason = reason;
      },
    });

    const result = await readStream(stream, undefined, 15);
    expect(cancelCalled).toBe(true);
    expect(cancelReason).toBe('Stream limit exceeded');
    expect(result.length).toBeLessThanOrEqual(15);
  });

  test('non-session hook dispatch caps logged stdout to NON_SESSION_STREAM_CAP_BYTES in jsonl logs', async () => {
    const root = makeTempDir();
    writeHook(root, 'tool-execute-before.sh', "#!/usr/bin/env bash\nhead -c 32768 < /dev/zero | tr '\\0' 'A'\nexit 0\n");
    const logFile = path.join(root, 'logs.jsonl');

    const wrapper = new HooksWrapper(root, undefined, { logFile });
    await wrapper.dispatch(HookEvent.ToolExecuteBefore, {
      tool: 'bash',
      args: { command: 'test' },
    });

    const logResult = readHookLogRecords(logFile);
    expect(logResult.kind).toBe('ok');
    if (logResult.kind === 'ok') {
      expect(logResult.records).toHaveLength(1);
      expect(logResult.records[0]!.stdout?.length).toBe(NON_SESSION_STREAM_CAP_BYTES);
    }

    wrapper.dispose();
  });

  test('default 2m timeout triggers when OWFLOW_HOOK_TIMEOUT_MS is unset, and is disabled when set to 0', async () => {
    const root = makeTempDir();
    writeHook(root, 'config.sh');

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
          fn();
        }
        return 1 as any;
      }) as typeof setTimeout);

      const wrapper = new HooksWrapper(root);
      await expect(wrapper.dispatch(HookEvent.Config, {})).rejects.toThrow(/timed out after 120000ms/);
      expect(recordedDelay).toBe(120_000);
      expect(killed).toBe(true);
      wrapper.dispose();

      // Disabled when set to 0
      process.env[HOOK_TIMEOUT_ENV] = '0';
      let timeoutScheduled = false;
      setTimeoutSpy.mockImplementation(((fn: () => void, ms?: number) => {
        if (ms !== STATUS_DEBOUNCE_MS) {
          timeoutScheduled = true;
        }
        return 1 as any;
      }) as typeof setTimeout);

      spawnSpy.mockImplementation(
        () =>
          ({
            pid: 12346,
            kill: () => {},
            exited: Promise.resolve(0),
            stdout: new Response('').body,
            stderr: new Response('').body,
            signalCode: null,
          }) as any,
      );

      const wrapper2 = new HooksWrapper(root);
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
    writeHook(root, 'tool-execute-before.sh', '#!/usr/bin/env bash\necho "debug-ok"\nexit 0\n');

    const errLines: string[] = [];
    const errSpy = spyOn(console, 'error').mockImplementation((msg: string) => {
      errLines.push(msg);
    });

    const prevDebug = process.env.OWFLOW_DEBUG;
    process.env.OWFLOW_DEBUG = '1';

    try {
      const wrapper = new HooksWrapper(root);
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
    writeHook(root, 'tool-execute-before.sh');

    const spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    const logFile = path.join(root, 'logs.jsonl');

    try {
      const wrapper = new HooksWrapper(root, undefined, { logFile });
      await expect(wrapper.dispatch(HookEvent.ToolExecuteBefore, {}, {})).rejects.toThrow(/Blocked: failed to spawn hook.*EACCES: permission denied/);

      const logs = readHookLogRecords(logFile);
      expect(logs.kind).toBe('ok');
      if (logs.kind === 'ok') {
        expect(logs.records).toHaveLength(1);
        expect(logs.records[0]!.status).toBe(HookRunState.FAILURE);
        expect(logs.records[0]!.reason).toContain('EACCES: permission denied');
      }
      wrapper.dispose();
    } finally {
      spawnSpy.mockRestore();
    }
  });

  test('createDispatchHandlers isolates reactive host event failures from crashing OpenCode event bus without leaking to console', async () => {
    const root = makeTempDir();
    const wrapper = new HooksWrapper(root);
    const crashEvents: Array<{ source: string; error: unknown }> = [];
    const crashSpy = spyOn(hooksPersistenceModule, 'writeHookCrashLog').mockImplementation((_ws, source, error) => {
      crashEvents.push({ source, error });
    });
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    try {
      spyOn(wrapper, 'dispatch').mockImplementation(async (ev: string) => {
        if (ev === 'session.idle') throw new Error('Blocked: idle check failed');
        if (ev === HookEvent.Event) throw new Error('Blocked: catch-all event failed');
      });

      const handlers = wrapper.createDispatchHandlers();

      // Dispatching reactive event via host Event handler should NOT throw unhandled rejection
      await handlers[HookEvent.Event]!({ event: { type: 'session.idle' } } as any);

      // Does not leak to console.warn / terminal in the working TUI
      expect(warnSpy).not.toHaveBeenCalled();
      // Records failures to persistent crash log instead
      expect(crashEvents.some((e) => e.source === 'reactive_host_event_session.idle')).toBe(true);
      expect(crashEvents.some((e) => e.source === 'catch_all_event_hook')).toBe(true);
    } finally {
      crashSpy.mockRestore();
      warnSpy.mockRestore();
      wrapper.dispose();
    }
  });

  test('createDispatchHandlers routes passthrough lifecycle events to dispatch', async () => {
    const root = makeTempDir();
    const wrapper = new HooksWrapper(root);
    const dispatched: string[] = [];
    spyOn(wrapper, 'dispatch').mockImplementation(async (ev: string) => {
      dispatched.push(ev);
    });

    const handlers = wrapper.createDispatchHandlers();
    await handlers[HookEvent.CommandExecuteBefore]!({ command: 'ls' } as any, {} as any);
    await handlers[HookEvent.ToolExecuteAfter]!({ tool: 'bash' } as any, {} as any);

    expect(dispatched).toEqual([HookEvent.CommandExecuteBefore, HookEvent.ToolExecuteAfter]);
    wrapper.dispose();
  });

  test('debounces transient PENDING status writes and atomically flushes terminal states', async () => {
    const root = makeTempDir();
    writeHook(root, 'tool-execute-before.sh');
    const statusFile = path.join(root, 'status.json');

    let renameCount = 0;
    const origRenameSync = fs.renameSync;
    const renameSpy = spyOn(fs, 'renameSync').mockImplementation((oldPath, newPath) => {
      if (typeof newPath === 'string' && newPath.includes('status.json')) {
        renameCount += 1;
      }
      return origRenameSync(oldPath, newPath);
    });

    try {
      const wrapper = new HooksWrapper(root, undefined, { statusFile });
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
    writeHook(root, 'tool-execute-before.sh', '#!/usr/bin/env bash\nsleep 0.12\nexit 0\n');
    const statusFile = path.join(root, 'status-slow.json');

    const wrapper = new HooksWrapper(root, undefined, { statusFile });
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
    const recorder = new StatusRecorder({ directory: root, statusFile });

    const renameSpy = spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('EACCES: mock rename failure');
    });

    try {
      recorder.flushStatusFileAtomic(statusFile, root, new Map());
      const tmpFiles = fs.readdirSync(root).filter((f) => f.endsWith('.tmp'));
      expect(tmpFiles).toHaveLength(0);
    } finally {
      renameSpy.mockRestore();
      recorder.dispose();
    }
  });

  describe('buildExecutionArgs', () => {
    const pwshFlags = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File'];
    const makeEntry = (path: string, resolved: string, expected: string): HookRegistryEntry => ({
      path,
      event: HookEvent.ToolExecuteBefore,
      interpreter: { resolved, expected, available: true },
      status: 'registered',
    });

    test('prepends PowerShell execution flags for .ps1 scripts', () => {
      const entry = makeEntry('/workspace/.owflow/hooks/tool-execute-before.ps1', '/usr/bin/pwsh', 'pwsh');
      expect(buildExecutionArgs(entry)).toEqual(['/usr/bin/pwsh', ...pwshFlags, entry.path]);
    });

    test('prepends PowerShell execution flags when interpreter is powershell.exe', () => {
      const entry = makeEntry(
        'C:\\workspace\\.owflow\\hooks\\session-idle.ps1',
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        'powershell.exe',
      );
      expect(buildExecutionArgs(entry)).toEqual(['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ...pwshFlags, entry.path]);
    });

    test('prepends PowerShell execution flags when expected interpreter is pwsh even with non-standard path', () => {
      const entry = makeEntry('/workspace/.owflow/hooks/custom-script', '/opt/microsoft/powershell/7/pwsh', 'pwsh');
      expect(buildExecutionArgs(entry)).toEqual(['/opt/microsoft/powershell/7/pwsh', ...pwshFlags, entry.path]);
    });

    test('returns standard [resolved, path] arguments for non-PowerShell scripts', () => {
      const entry = makeEntry('/workspace/.owflow/hooks/tool-execute-before.sh', '/bin/bash', 'bash');
      expect(buildExecutionArgs(entry)).toEqual(['/bin/bash', entry.path]);
    });
  });

  describe('modular runtime components', () => {
    test('CircuitBreakerTracker tracks, trips, resets on success, and clears', () => {
      const tracker = new CircuitBreakerTracker();
      expect(tracker.check(HookEvent.ToolExecuteBefore, '/test/hook.sh', 'ses_1')).toEqual({ tripped: false });

      const now = Date.now();
      tracker.recordFailure(HookEvent.ToolExecuteBefore, '/test/hook.sh', 'ses_1', now, now + 10);
      expect(tracker.check(HookEvent.ToolExecuteBefore, '/test/hook.sh', 'ses_1')).toEqual({ tripped: false });

      tracker.recordFailure(HookEvent.ToolExecuteBefore, '/test/hook.sh', 'ses_1', now + 20, now + 30);
      tracker.recordFailure(HookEvent.ToolExecuteBefore, '/test/hook.sh', 'ses_1', now + 40, now + 50);
      const res = tracker.recordFailure(HookEvent.ToolExecuteBefore, '/test/hook.sh', 'ses_1', now + 60, now + 70);
      expect(res.rapidFailures).toBe(4);
      expect(res.trippedUntil).toBeGreaterThan(0);

      const checkTripped = tracker.check(HookEvent.ToolExecuteBefore, '/test/hook.sh', 'ses_1');
      expect(checkTripped.tripped).toBe(true);
      expect(checkTripped.reason).toContain('Circuit breaker active for /test/hook.sh');

      tracker.recordSuccess(HookEvent.ToolExecuteBefore, '/test/hook.sh', 'ses_1');
      expect(tracker.check(HookEvent.ToolExecuteBefore, '/test/hook.sh', 'ses_1')).toEqual({ tripped: false });

      tracker.recordFailure(HookEvent.ToolExecuteBefore, '/test/hook.sh', 'ses_1', now + 80, now + 90);
      tracker.clear();
      expect(tracker.check(HookEvent.ToolExecuteBefore, '/test/hook.sh', 'ses_1')).toEqual({ tripped: false });
    });

    test('SessionAbortController manages cooldown, session clearing, and disposal', async () => {
      const aborted: string[] = [];
      const controller = new SessionAbortController((sessionID) => {
        aborted.push(sessionID);
      });

      await controller.abortSession(HookEvent.ToolExecuteBefore, 'ses_abc', '/path/to/script.sh');
      expect(aborted).toEqual(['ses_abc']);

      // Within cooldown, second abort is suppressed
      await controller.abortSession(HookEvent.ToolExecuteBefore, 'ses_abc', '/path/to/script.sh');
      expect(aborted).toEqual(['ses_abc']);

      // Clearing session cooldown allows another abort
      controller.clearSession('ses_abc');
      await controller.abortSession(HookEvent.ToolExecuteBefore, 'ses_abc', '/path/to/script.sh');
      expect(aborted).toEqual(['ses_abc', 'ses_abc']);

      controller.dispose();
    });

    test('StatusRecorder dedupes identical runs and evicts oldest entries when capacity exceeds 1,000', () => {
      const root = makeTempDir();
      const logFile = path.join(root, 'evict.jsonl');
      const recorder = new StatusRecorder({ directory: root, logFile });
      expect(recorder.getAllStatuses().size).toBe(0);

      const makeRecord = (id: number): HookRunLogRecord => ({
        version: 1,
        runId: `run#${id}`,
        pid: 1,
        workspace: root,
        event: HookEvent.ToolExecuteBefore,
        hook: '/hook.sh',
        name: 'tool-execute-before',
        startedAt: 1000,
        finishedAt: 1010,
        durationMs: 10,
        status: HookRunState.SUCCESS,
      });

      // 1. Write run#0
      recorder.appendLog(makeRecord(0));
      // Appending duplicate run#0 with same status is deduped
      recorder.appendLog(makeRecord(0));

      const set = (recorder as any).writtenRunRecords as Set<string>;
      expect(set.size).toBe(1);
      expect(set.has('run#0:success')).toBe(true);

      // 2. Add 1,000 distinct records to exceed the 1,000 bounded capacity (1 + 1000 = 1001 total records)
      for (let i = 1; i <= 1000; i++) {
        recorder.appendLog(makeRecord(i));
      }

      // Capacity should be bounded to 1,000 entries
      expect(set.size).toBe(1000);
      // run#0 was the oldest entry and was evicted
      expect(set.has('run#0:success')).toBe(false);
      // Recent runs are still tracked
      expect(set.has('run#1000:success')).toBe(true);
      expect(set.has('run#1:success')).toBe(true);

      // 3. run#1000 is still active in the set and should be deduped
      recorder.appendLog(makeRecord(1000));
      expect(set.size).toBe(1000);

      // 4. run#0 was evicted, so appending it again re-adds it
      recorder.appendLog(makeRecord(0));
      expect(set.size).toBe(1000);
      expect(set.has('run#0:success')).toBe(true);
      // and now run#1 was evicted as the new oldest entry
      expect(set.has('run#1:success')).toBe(false);

      recorder.dispose();
    });

    test('executeHookProcess throws HookSpawnError when process cannot be spawned', async () => {
      const root = makeTempDir();
      const entry: HookRegistryEntry = {
        path: path.join(root, 'nonexistent.sh'),
        event: HookEvent.ToolExecuteBefore,
        interpreter: {
          resolved: '/nonexistent/interpreter',
          expected: 'bash',
          available: false,
        },
        status: 'registered',
      };

      const spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        throw new Error('ENOENT: spawn failed');
      });

      try {
        await expect(
          executeHookProcess({
            entry,
            directory: root,
            stdinText: '{}',
            event: HookEvent.ToolExecuteBefore,
          }),
        ).rejects.toBeInstanceOf(HookSpawnError);
      } finally {
        spawnSpy.mockRestore();
      }
    });

    test('error builders generate expected Blocked error messages and hints', () => {
      const cbErr = buildCircuitBreakerError('/path/hook.sh', 'too many failures');
      expect(cbErr.message).toBe('Blocked: too many failures. Hint: fix /path/hook.sh or wait for cooldown.');

      const interpErr = buildInterpreterUnavailableError('/path/hook.sh', 'pwsh');
      expect(interpErr.message).toContain('the pwsh interpreter is not available');

      const spawnErr = buildSpawnError('/path/hook.sh', 'permission denied', HookEvent.ToolExecuteBefore);
      expect(spawnErr.message).toContain('failed to spawn hook /path/hook.sh: permission denied');
      expect(spawnErr.message).toContain('failure ends the current session; fail closed');

      const procErr = buildProcessFailureError('/path/hook.sh', 'exit 1', HookEvent.ToolExecuteBefore);
      expect(procErr.message).toContain('Blocked: exit 1. Hint: fix the failing script');

      const nonAbortProcErr = buildProcessFailureError('/path/hook.sh', 'exit 1', 'session.idle');
      expect(nonAbortProcErr.message).toContain('failure recorded; fail closed');
    });
  });
});
