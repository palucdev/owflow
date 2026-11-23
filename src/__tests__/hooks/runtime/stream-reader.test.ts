import { describe, expect, test } from 'bun:test';
import { readStream } from '../../../hooks/runtime/stream-reader.js';

const SMALL_MAX_BYTES = 15;
const OPTIONS_MAX_BYTES = 100;
const NULL_VALUE: null = JSON.parse('null');

describe('stream-reader (bounded subprocess output reading)', () => {
  test('readStream reads stream within limit and handles null/undefined streams', async () => {
    expect(await readStream({stream: NULL_VALUE, onChunk: () => {}})).toBe('');
    expect(await readStream({stream: undefined, onChunk: () => {}})).toBe('');

    const stream = new Response('hello world').body;
    const chunks: string[] = [];
    const result = await readStream({stream, onChunk: (chunk: string) => {
      chunks.push(chunk);
    }});
    expect(result).toBe('hello world');
    expect(chunks.join('')).toBe('hello world');
  });

  test('readStream should cancel stream reader and bound output when maxBytes is exceeded', async () => {
    let isCancelCalled = false;
    let cancelReason: unknown;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('chunk-one-12345-chunk-two-67890-chunk-three-ignored'));
      },
      cancel(reason) {
        isCancelCalled = true;
        cancelReason = reason;
      },
    });

    const result = await readStream({stream, onChunk: undefined, maxBytes: SMALL_MAX_BYTES});
    expect(isCancelCalled).toBe(true);
    expect(cancelReason).toBe('Stream limit exceeded');
    expect(result.length).toBeLessThanOrEqual(SMALL_MAX_BYTES);
  });

  test('readStream supports the options-object call form', async () => {
    const stream = new Response('options form').body;
    const chunks: string[] = [];
    const result = await readStream({
      stream: stream!,
      onChunk: (chunk) => {
        chunks.push(chunk);
      },
      maxBytes: OPTIONS_MAX_BYTES,
    });
    expect(result).toBe('options form');
    expect(chunks.join('')).toBe('options form');
  });
});
