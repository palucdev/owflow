const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;
const STREAM_BUFFER_MEGABYTES = 4;
export const MAX_STREAM_BUFFER_BYTES = STREAM_BUFFER_MEGABYTES * BYTES_PER_MEGABYTE;

export interface ReadStreamOptions {
  readonly stream: ReadableStream<Uint8Array> | null | undefined;
  readonly onChunk?: (chunk: string) => void;
  readonly maxBytes?: number;
}

interface StreamAccumulator {
  result: string;
  totalBytes: number;
  readonly maxBytes: number;
  readonly onChunk?: (chunk: string) => void;
}

const appendDecodedChunk = (accumulator: StreamAccumulator, chunk: string): void => {
  if (!chunk) {
    return;
  }
  if (accumulator.result.length < accumulator.maxBytes) {
    accumulator.result += chunk.slice(0, accumulator.maxBytes - accumulator.result.length);
  }
  accumulator.onChunk?.(chunk);
};

export const readStream = async (options: ReadStreamOptions): Promise<string> => {
  const { stream, onChunk, maxBytes = MAX_STREAM_BUFFER_BYTES } = options;
  if (!stream) {
    return '';
  }
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const accumulator: StreamAccumulator = { result: '', totalBytes: 0, maxBytes, onChunk };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      accumulator.totalBytes += value.byteLength;
      appendDecodedChunk(accumulator, decoder.decode(value, { stream: true }));
      if (accumulator.totalBytes >= maxBytes) {
        try {
          await reader.cancel('Stream limit exceeded');
        } catch {
          // ignore stream cancellation error
        }
        break;
      }
    }
    appendDecodedChunk(accumulator, decoder.decode());
  } catch {
    // ignore stream reading error
  }
  return accumulator.result;
};
