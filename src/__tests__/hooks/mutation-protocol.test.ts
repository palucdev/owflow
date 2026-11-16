import { describe, expect, test } from 'bun:test';
import {
  MutationProtocolError,
  applyHookMutation,
  buildMutationNotice,
  isMutableHookEvent,
  parseMutationEnvelope,
} from '../../hooks/runtime/mutation-protocol.js';

const envelope = (mutate: unknown, hint = 'do the thing', extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ $owflow: 1, mutate, hint, ...extra });

describe('mutation-protocol', () => {
  describe('parseMutationEnvelope', () => {
    test('parses a valid envelope with $owflow, mutate, hint, and optional reason', () => {
      expect(parseMutationEnvelope(envelope({ output: 'patched' }, 'Use lint', { reason: 'failed check' }))).toEqual({
        kind: 'mutation',
        envelope: { $owflow: 1, mutate: { output: 'patched' }, hint: 'Use lint', reason: 'failed check' },
      });
    });

    test('ignores plain text and ordinary JSON logs', () => {
      expect(parseMutationEnvelope('plain log line\n')).toEqual({ kind: 'none' });
      expect(parseMutationEnvelope(JSON.stringify({ message: 'ordinary json log' }))).toEqual({ kind: 'none' });
      expect(parseMutationEnvelope('not json {')).toEqual({ kind: 'none' });
    });

    test('rejects a wrong protocol version', () => {
      expect(() => parseMutationEnvelope(JSON.stringify({ $owflow: 2, mutate: {}, hint: 'x' }))).toThrow(MutationProtocolError);
      expect(() => parseMutationEnvelope(JSON.stringify({ $owflow: 2, mutate: {}, hint: 'x' }))).toThrow(/unsupported \$owflow version/);
    });

    test('rejects missing or non-object mutate', () => {
      expect(() => parseMutationEnvelope(JSON.stringify({ $owflow: 1, hint: 'x' }))).toThrow(/"mutate" must be a plain object/);
      expect(() => parseMutationEnvelope(JSON.stringify({ $owflow: 1, mutate: [], hint: 'x' }))).toThrow(/"mutate" must be a plain object/);
      expect(() => parseMutationEnvelope(JSON.stringify({ $owflow: 1, mutate: 'x', hint: 'x' }))).toThrow(/"mutate" must be a plain object/);
    });

    test('rejects missing, empty, or non-string hint', () => {
      expect(() => parseMutationEnvelope(JSON.stringify({ $owflow: 1, mutate: {} }))).toThrow(/"hint" must be a non-empty string/);
      expect(() => parseMutationEnvelope(JSON.stringify({ $owflow: 1, mutate: {}, hint: '   ' }))).toThrow(/"hint" must be a non-empty string/);
      expect(() => parseMutationEnvelope(JSON.stringify({ $owflow: 1, mutate: {}, hint: 3 }))).toThrow(/"hint" must be a non-empty string/);
    });

    test('rejects unknown top-level fields and wrong reason types', () => {
      expect(() => parseMutationEnvelope(envelope({}, 'x', { extra: true }))).toThrow(/unsupported field "extra"/);
      expect(() => parseMutationEnvelope(envelope({}, 'x', { reason: 7 }))).toThrow(/"reason" must be a string/);
    });
  });

  describe('event recognition', () => {
    test('recognizes exactly the eight stable mutable hooks', () => {
      const mutable = [
        'chat.message',
        'chat.params',
        'chat.headers',
        'command.execute.before',
        'tool.definition',
        'tool.execute.before',
        'tool.execute.after',
        'shell.env',
      ];
      for (const event of mutable) expect(isMutableHookEvent(event as never)).toBe(true);
      expect(isMutableHookEvent('config')).toBe(false);
      expect(isMutableHookEvent('event')).toBe(false);
      expect(isMutableHookEvent('dispose')).toBe(false);
      expect(isMutableHookEvent('session.idle')).toBe(false);
      expect(isMutableHookEvent('experimental.session.compacting')).toBe(false);
    });

    test('rejects mutation application for unsupported events', () => {
      expect(() => applyHookMutation('config', {}, {})).toThrow(MutationProtocolError);
      expect(() => applyHookMutation('event', {}, {})).toThrow(/does not support mutations/);
    });
  });

  describe('applyHookMutation', () => {
    test('chat.message merges message fields, replaces parts, and appends the notice part', () => {
      const output: Record<string, unknown> = {
        message: { id: 'msg-1', role: 'user', agent: 'main' },
        parts: [{ type: 'text', text: 'old' }],
      };
      applyHookMutation(
        'chat.message',
        output,
        {
          message: { agent: 'build', model: { providerID: 'openai', modelID: 'gpt' }, system: 'be nice', tools: { bash: true } },
          parts: [{ type: 'text', text: 'new' }],
        },
        '[chat-message]: Hint: keep it scoped',
      );

      expect(output.message).toEqual({
        id: 'msg-1',
        role: 'user',
        agent: 'build',
        model: { providerID: 'openai', modelID: 'gpt' },
        system: 'be nice',
        tools: { bash: true },
      });
      expect(output.parts).toEqual([
        { type: 'text', text: 'new' },
        { type: 'text', text: '[chat-message]: Hint: keep it scoped' },
      ]);
    });

    test('chat.message rejects immutable identity fields', () => {
      expect(() => applyHookMutation('chat.message', { message: { id: 'x' }, parts: [] }, { message: { id: 'y' } })).toThrow(
        /unsupported field "id"/,
      );
      expect(() => applyHookMutation('chat.message', { message: {}, parts: [] }, { message: { sessionID: 'y' } })).toThrow(
        /unsupported field "sessionID"/,
      );
    });

    test('chat.params assigns fields, unsets null fields, and merges options', () => {
      const output: Record<string, unknown> = { temperature: 1, topP: 1, options: { a: 1 } };
      applyHookMutation('chat.params', output, { temperature: 0.5, topP: null, options: { b: 2 } });
      expect(output.temperature).toBe(0.5);
      expect('topP' in output).toBe(false);
      expect(output.options).toEqual({ a: 1, b: 2 });
    });

    test('chat.params rejects wrong field types', () => {
      expect(() => applyHookMutation('chat.params', {}, { temperature: 'hot' })).toThrow(/"temperature" must be a number or null/);
    });

    test('chat.headers shallow-merges headers', () => {
      const output: Record<string, unknown> = { headers: { a: '1' } };
      applyHookMutation('chat.headers', output, { headers: { b: '2' } });
      expect(output.headers).toEqual({ a: '1', b: '2' });
    });

    test('command.execute.before replaces parts and appends the notice part', () => {
      const output: Record<string, unknown> = { parts: [{ type: 'text', text: 'old' }] };
      applyHookMutation('command.execute.before', output, { parts: [{ type: 'text', text: 'new' }] }, '[command-execute-before]: Hint: scoped');
      expect(output.parts).toEqual([
        { type: 'text', text: 'new' },
        { type: 'text', text: '[command-execute-before]: Hint: scoped' },
      ]);
    });

    test('tool.definition assigns description and replaces parameters', () => {
      const output: Record<string, unknown> = { description: 'old', parameters: { a: 1 } };
      applyHookMutation('tool.definition', output, { description: 'new', parameters: { b: 2 } });
      expect(output.description).toBe('new');
      expect(output.parameters).toEqual({ b: 2 });
    });

    test('tool.execute.before shallow-merges args without replacing the object', () => {
      const args = { command: 'ls', timeout: 1 };
      const output: Record<string, unknown> = { args };
      applyHookMutation('tool.execute.before', output, { args: { timeout: 2, cwd: '/tmp' } });
      expect(output.args).toBe(args);
      expect(output.args).toEqual({ command: 'ls', timeout: 2, cwd: '/tmp' });
    });

    test('tool.execute.after assigns title/output and merges metadata', () => {
      const metadata = { a: 1 };
      const output: Record<string, unknown> = { title: 'old', output: 'old result', metadata };
      applyHookMutation('tool.execute.after', output, { title: 'new', output: 'patched result', metadata: { b: 2 } });
      expect(output.title).toBe('new');
      expect(output.output).toBe('patched result');
      expect(output.metadata).toBe(metadata);
      expect(output.metadata).toEqual({ a: 1, b: 2 });
    });

    test('shell.env shallow-merges environment variables', () => {
      const env = { PATH: '/bin', CI: '0' };
      const output: Record<string, unknown> = { env };
      applyHookMutation('shell.env', output, { env: { CI: '1', DEBUG: 'true' } });
      expect(output.env).toBe(env);
      expect(output.env).toEqual({ PATH: '/bin', CI: '1', DEBUG: 'true' });
    });

    test('rejects unknown patch keys per event', () => {
      expect(() => applyHookMutation('tool.execute.after', { output: '' }, { stdout: 'x' })).toThrow(
        /unsupported field "stdout" in tool.execute.after mutation/,
      );
      expect(() => applyHookMutation('shell.env', {}, { environment: {} })).toThrow(/unsupported field "environment"/);
    });
  });

  describe('buildMutationNotice', () => {
    test('produces exactly [<hook-name>]: Hint: <text>', () => {
      expect(buildMutationNotice('tool-execute-after', 'Remove unused imports before re-running.')).toBe(
        '[tool-execute-after]: Hint: Remove unused imports before re-running.',
      );
      expect(buildMutationNotice('chat-message', '  trimmed  ')).toBe('[chat-message]: Hint: trimmed');
    });
  });
});
