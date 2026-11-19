import { describe, expect, test } from 'bun:test';
import {
  buildStdinPayload,
  eventTypeFrom,
  resolveStdinPayloadOptions,
  sessionIDFrom,
} from '../../../hooks/wrapper/payload-builder.js';
import { HookEvent } from '../../../types/hook-types.js';

const NULL_VALUE: null = JSON.parse('null');

describe('payload-builder (stdin payload composition)', () => {
  test('buildStdinPayload strips class instance internals to identity keys and handles bigint', () => {
    class SecretModel {
      id = 'claude-4';
      providerID = 'anthropic';
      name = 'Claude';
      apiKey = 'sk-secret';
    }
    const raw = buildStdinPayload(
      resolveStdinPayloadOptions(HookEvent.ToolExecuteBefore, [
        { tool: 'bash', count: 42n, model: new SecretModel() },
        { args: { command: 'ls' } },
        'ses_1',
      ]),
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
    const circularObject: Record<string, unknown> = { name: 'circular-test' };
    circularObject.self = circularObject;
    const raw = buildStdinPayload({ event: HookEvent.ToolExecuteBefore, input: circularObject, output: {}, sessionID: 'ses_circ' });
    expect(() => JSON.parse(raw)).not.toThrow();
    const parsed = JSON.parse(raw);
    expect(parsed.context.self.self).toBe('[Circular]');
  });

  test('buildStdinPayload omits the session block when no sessionID is provided', () => {
    const raw = buildStdinPayload({ event: HookEvent.ToolExecuteBefore, input: { tool: 'bash' } });
    expect(JSON.parse(raw)).toEqual({
      event: 'tool.execute.before',
      context: { tool: 'bash' },
    });
  });
});

describe('payload-builder (option and envelope resolution)', () => {
  test('resolveStdinPayloadOptions accepts both positional and options-object forms', () => {
    expect(
      resolveStdinPayloadOptions(HookEvent.ToolExecuteBefore, [{ tool: 'bash' }, { done: true }, 'ses_pos']),
    ).toEqual({
      event: HookEvent.ToolExecuteBefore,
      input: { tool: 'bash' },
      output: { done: true },
      sessionID: 'ses_pos',
    });

    const options = { event: HookEvent.Config, input: { value: 1 } } as const;
    expect(resolveStdinPayloadOptions(options, [])).toBe(options);
  });

  test('sessionIDFrom resolves the first available session identifier across envelopes', () => {
    expect(sessionIDFrom({ sessionID: 'ses_direct' })).toBe('ses_direct');
    expect(sessionIDFrom({ event: { type: 'session.idle', properties: { sessionID: 'ses_props' } } })).toBe('ses_props');
    expect(sessionIDFrom({ event: { type: 'session.idle', properties: { part: { sessionID: 'ses_part' } } } })).toBe('ses_part');
    expect(sessionIDFrom({ event: { type: 'session.idle', properties: { info: { sessionID: 'ses_info' } } } })).toBe('ses_info');
    expect(sessionIDFrom({ tool: 'bash' })).toBeUndefined();
    expect(sessionIDFrom(undefined)).toBeUndefined();
    expect(sessionIDFrom('ses_string')).toBeUndefined();
  });

  test('eventTypeFrom extracts the host event type from the envelope', () => {
    expect(eventTypeFrom({ event: { type: 'session.idle' } })).toBe('session.idle');
    expect(eventTypeFrom({ event: 'not-an-envelope' })).toBeUndefined();
    expect(eventTypeFrom({})).toBeUndefined();
    expect(eventTypeFrom(NULL_VALUE)).toBeUndefined();
  });
});
