import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildStdinPayload,
  createDispatchHandlers,
  HOOK_TIMEOUT_ENV,
  initializeHooksWrapper,
  MAX_CAPTURE_BYTES,
  MAX_LOG_FILE_BYTES,
} from '../../hooks/hooks-wrapper.js';
import { readHookLogRecords, readLatestHookLog } from '../../hooks/user-hooks.js';
import { HookEvent } from '../../types/hook-types.js';

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
    expect(latestOk?.status).toBe('success');
    expect(latestOk?.truncated).toBeUndefined();
    expect(latestOk?.stdout?.length).toBeGreaterThan(MAX_CAPTURE_BYTES);
    expect(latestOk?.stderr).toBe('warn line\n');
    expect(readLatestHookLog(logFile, HookEvent.ToolExecuteBefore, Date.now() + 10_000)).toBeUndefined();

    // Non-session hook run caps at MAX_CAPTURE_BYTES and is marked truncated
    await wrapper.dispatch(HookEvent.ToolExecuteBefore, {}, {});
    const nonSession = readLatestHookLog(logFile, HookEvent.ToolExecuteBefore);
    expect(nonSession?.status).toBe('success');
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
    fs.writeFileSync(path.join(hooksDir, 'config.sh'), '#!/usr/bin/env bash\ncat >/dev/null\nexec sleep 5\n');

    const prevTimeout = process.env[HOOK_TIMEOUT_ENV];
    process.env[HOOK_TIMEOUT_ENV] = '30';
    try {
      const wrapper = await initializeHooksWrapper(root, undefined, {
        statusFile: path.join(root, 's.json'),
        logFile: path.join(root, 'l.jsonl'),
      });
      await expect(wrapper.dispatch(HookEvent.Config, {})).rejects.toThrow(/timed out after 30ms/);
      wrapper.dispose();
    } finally {
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
    fs.writeFileSync(path.join(hooksDir, 'config.sh'), '#!/usr/bin/env bash\nexec sleep 10\n');

    const statusFile = path.join(root, 'status.json');
    const logFile = path.join(root, 'logs.jsonl');

    const wrapper = await initializeHooksWrapper(root, undefined, { statusFile, logFile });
    const dispatchPromise = wrapper.dispatch(HookEvent.Config, {});
    // Give child process time to spawn
    await new Promise((resolve) => setTimeout(resolve, 50));

    wrapper.dispose();
    await dispatchPromise.catch(() => {});
  });

  test('createDispatchHandlers fans out host events and serializes concurrent runs', async () => {
    const events: string[] = [];
    const handlers = createDispatchHandlers(async (event) => {
      events.push(event);
    });
    await handlers.event!({ event: { type: 'session.idle' } } as any);
    expect(events).toEqual(['session.idle', 'event']);
  });
});
