import { describe, expect, test } from 'bun:test';
import { buildStdinPayload, eventTypeFrom, sessionIDFrom } from '../../../hooks/wrapper/payload-builder.js';
import { HookEventName, HostEventName } from '../../../types/hook-types.js';

const NULL_VALUE: null = JSON.parse('null');

describe('payload-builder (stdin payload composition)', () => {
  test('buildStdinPayload serializes circular context references without throwing', () => {
    const circularObject: Record<string, unknown> = { name: 'circular-test' };
    circularObject.self = circularObject;
    const raw = buildStdinPayload({ event: HookEventName.ToolExecuteBefore, input: circularObject, output: {}, sessionID: 'ses_circ' });
    expect(() => JSON.parse(raw)).not.toThrow();
    const parsed = JSON.parse(raw);
    expect(parsed.context.self.self).toBe('[Circular]');
  });

  test('buildStdinPayload omits the session block when no sessionID is provided', () => {
    const raw = buildStdinPayload({ event: HookEventName.ToolExecuteBefore, input: { tool: 'bash' } });
    expect(JSON.parse(raw)).toEqual({
      event: 'tool.execute.before',
      context: { tool: 'bash' },
    });
  });
});

describe('payload-builder (option and envelope resolution)', () => {
  test('sessionIDFrom resolves the first available session identifier across envelopes', () => {
    expect(sessionIDFrom({ sessionID: 'ses_direct' })).toBe('ses_direct');
    expect(sessionIDFrom({ event: { type: HostEventName.SessionIdle, properties: { sessionID: 'ses_props' } } })).toBe('ses_props');
    expect(sessionIDFrom({ event: { type: HostEventName.SessionIdle, properties: { part: { sessionID: 'ses_part' } } } })).toBe('ses_part');
    expect(sessionIDFrom({ event: { type: HostEventName.SessionIdle, properties: { info: { sessionID: 'ses_info' } } } })).toBe('ses_info');
    expect(sessionIDFrom({ tool: 'bash' })).toBeUndefined();
    expect(sessionIDFrom(undefined)).toBeUndefined();
    expect(sessionIDFrom('ses_string')).toBeUndefined();
  });

  test('eventTypeFrom extracts the host event type from the envelope', () => {
    expect(eventTypeFrom({ event: { type: HostEventName.SessionIdle } })).toBe(HostEventName.SessionIdle);
    expect(eventTypeFrom({ event: 'not-an-envelope' })).toBeUndefined();
    expect(eventTypeFrom({})).toBeUndefined();
    expect(eventTypeFrom(NULL_VALUE)).toBeUndefined();
  });
});
