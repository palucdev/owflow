import { describe, expect, test } from 'bun:test';
import { MAX_STREAM_BUFFER_BYTES, readStream } from '../../../hooks/runtime/stream-reader.js';

const EXPORTED_STREAM_BUFFER_CAP_BYTES = 4_194_304;
const SMALL_MAX_BYTES = 15;
const OPTIONS_MAX_BYTES = 100;
const NULL_VALUE: null = JSON.parse('null');

describe('stream-reader (bounded subprocess output reading)', () => {
  test('exports the documented stream buffer cap', () => {
    expect(MAX_STREAM_BUFFER_BYTES).toBe(EXPORTED_STREAM_BUFFER_CAP_BYTES);
  });

  test('readStream reads stream within limit and handles null/undefined streams', async () => {
    expect(await readStream(NULL_VALUE, () => {})).toBe('');
    expect(await readStream(undefined, () => {})).toBe('');

    const stream = new Response('hello world').body;
    const chunks: string[] = [];
    const result = await readStream(stream, (chunk: string) => {
      chunks.push(chunk);
    });
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

    const result = await readStream(stream, undefined, SMALL_MAX_BYTES);
    expect(isCancelCalled).toBe(true);
    expect(cancelReason).toBe('Stream limit exceeded');
    expect(result.length).toBeLessThanOrEqual(SMALL_MAX_BYTES);
  });

  test('readStream supports the options-object call form', async () => {
    const stream = new Response('options form').body;
    const chunks: string[] = [];
    const result = await readStream({ stream: stream!, onChunk: (chunk) => {
      chunks.push(chunk);
    }, maxBytes: OPTIONS_MAX_BYTES });
    expect(result).toBe('options form');
    expect(chunks.join('')).toBe('options form');
  });
});
