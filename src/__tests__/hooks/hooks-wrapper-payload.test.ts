import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import HooksWrapper, { NON_SESSION_STREAM_CAP_BYTES } from '../../hooks/hooks-wrapper.js';
import { readHookLogRecords } from '../../hooks/hooks-persistence.js';
import { readStream } from '../../hooks/runtime/process-executor.js';
import { HookEvent, type HookEventName } from '../../types/hook-types.js';
import { cleanupWorkspaces, createWorkspace, expectOkLogResult, writeHookScript } from './hooks-test-helpers.js';

interface PayloadBuilder {
  buildStdinPayload: (...parameters: [HookEventName, unknown, unknown, string?]) => string;
}

const BIGINT_COUNT = 42n;
const SESSION_ID = 'ses_1';
const CIRCULAR_SESSION_ID = 'ses_circ';
const SYMLINK_SESSION_ID = 'ses_sym';
const STREAM_LIMIT_BYTES = 15;
const NON_SESSION_SCRIPT_BYTES = 32_768;
const NO_STREAM = JSON.parse('null') as null;
const NOOP = (): void => {};

const asPayloadBuilder = (wrapper: HooksWrapper): PayloadBuilder => wrapper as unknown as PayloadBuilder;

afterEach(cleanupWorkspaces);

describe('HooksWrapper stdin payload', () => {
  test('buildStdinPayload strips class instance internals to identity keys and handles bigint', () => {
    class SecretModel {
      id = 'claude-4';
      providerID = 'anthropic';
      name = 'Claude';
      apiKey = 'sk-secret';
    }
    const wrapper = new HooksWrapper(createWorkspace('owflow-wrapper-unit-'));

    try {
      const raw = asPayloadBuilder(wrapper).buildStdinPayload(
        HookEvent.ToolExecuteBefore,
        { tool: 'bash', count: BIGINT_COUNT, model: new SecretModel() },
        { args: { command: 'ls' } },
        SESSION_ID,
      );
      expect(raw).not.toContain('sk-secret');
      expect(JSON.parse(raw)).toEqual({
        event: 'tool.execute.before',
        session: { sessionID: SESSION_ID },
        context: {
          tool: 'bash',
          count: '42',
          model: { id: 'claude-4', providerID: 'anthropic', name: 'Claude' },
          args: { command: 'ls' },
        },
      });
    } finally {
      wrapper.dispose();
    }
  });

  test('buildStdinPayload serializes circular context references without throwing', () => {
    const circularObject: Record<string, unknown> = { name: 'circular-test' };
    Object.assign(circularObject, { self: circularObject });
    const wrapper = new HooksWrapper(createWorkspace('owflow-wrapper-unit-'));

    try {
      const raw = asPayloadBuilder(wrapper).buildStdinPayload(HookEvent.ToolExecuteBefore, circularObject, {}, CIRCULAR_SESSION_ID);
      expect(() => JSON.parse(raw)).not.toThrow();
      const parsed = JSON.parse(raw) as { context: { self: { self: string } } };
      expect(parsed.context.self.self).toBe('[Circular]');
    } finally {
      wrapper.dispose();
    }
  });
});

describe('HooksWrapper persistence safety', () => {
  test('runtime status and log persistence safely ignore dangling symlinks and clean up symlink rotation targets', async () => {
    const workspace = createWorkspace('owflow-wrapper-unit-');
    writeHookScript({ workspace, fileName: 'tool-execute-before.sh' });

    const targetFile = path.join(workspace, 'target-status.txt');
    const danglingStatus = path.join(workspace, 'dangling-status.json');
    fs.symlinkSync(targetFile, danglingStatus);

    const targetLog = path.join(workspace, 'target-log.txt');
    const danglingLog = path.join(workspace, 'dangling-log.jsonl');
    fs.symlinkSync(targetLog, danglingLog);

    const wrapper = new HooksWrapper(workspace, undefined, {
      statusFile: danglingStatus,
      logFile: danglingLog,
    });
    await wrapper.dispatch(HookEvent.ToolExecuteBefore, { sessionID: SYMLINK_SESSION_ID }, {});
    wrapper.dispose();

    expect(fs.existsSync(targetFile)).toBe(false);
    expect(fs.existsSync(targetLog)).toBe(false);
  });
});

describe('readStream', () => {
  test('readStream reads stream within limit and handles null/undefined streams', async () => {
    expect(await readStream(NO_STREAM, NOOP)).toBe('');
    expect(await readStream(undefined, NOOP)).toBe('');

    const stream = new Response('hello world').body;
    const chunks: string[] = [];
    const result = await readStream(stream, (chunk) => {
      chunks.push(chunk);
    });
    expect(result).toBe('hello world');
    expect(chunks.join('')).toBe('hello world');
  });

  test('readStream should cancel stream reader and bound output when maxBytes is exceeded', async () => {
    let isCancelled = false;
    let cancelReason: unknown;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('chunk-one-12345-chunk-two-67890-chunk-three-ignored'));
      },
      cancel(reason) {
        isCancelled = true;
        cancelReason = reason;
      },
    });

    const result = await readStream(stream, undefined, STREAM_LIMIT_BYTES);
    expect(isCancelled).toBe(true);
    expect(cancelReason).toBe('Stream limit exceeded');
    expect(result.length).toBeLessThanOrEqual(STREAM_LIMIT_BYTES);
  });
});

describe('HooksWrapper log caps', () => {
  test('non-session hook dispatch caps logged stdout to NON_SESSION_STREAM_CAP_BYTES in jsonl logs', async () => {
    const workspace = createWorkspace('owflow-wrapper-unit-');
    writeHookScript({
      workspace,
      fileName: 'tool-execute-before.sh',
      content: `#!/usr/bin/env bash\nhead -c ${NON_SESSION_SCRIPT_BYTES} < /dev/zero | tr '\\0' 'A'\nexit 0\n`,
    });
    const logFile = path.join(workspace, 'logs.jsonl');

    const wrapper = new HooksWrapper(workspace, undefined, { logFile });
    await wrapper.dispatch(HookEvent.ToolExecuteBefore, {
      tool: 'bash',
      args: { command: 'test' },
    });

    const logResult = expectOkLogResult(readHookLogRecords(logFile));
    expect(logResult.records).toHaveLength(1);
    expect(logResult.records[0]!.stdout?.length).toBe(NON_SESSION_STREAM_CAP_BYTES);

    wrapper.dispose();
  });
});
