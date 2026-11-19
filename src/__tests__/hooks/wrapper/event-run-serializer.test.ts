import { describe, expect, test } from 'bun:test';
import { createEventRunSerializer } from '../../../hooks/wrapper/event-run-serializer.js';

const FIRST_RUN_DELAY_MS = 20;
const SHORT_RUN_DELAY_MS = 5;
const DUPLICATE_DROP_DELAY_MS = 10;

describe('event-run-serializer (per-key run serialization)', () => {
  test('has() reports in-flight keys only and clears after completion', async () => {
    const serializer = createEventRunSerializer();
    expect(serializer.has('session.idle')).toBe(false);

    const { promise: barrier, resolve: release } = Promise.withResolvers<void>();
    const completion = serializer.run('session.idle', () => barrier);

    expect(serializer.has('session.idle')).toBe(true);

    release();
    await completion;
    expect(serializer.has('session.idle')).toBe(false);
  });

  test('runs for the same key are serialized while different keys run concurrently', async () => {
    const serializer = createEventRunSerializer();
    const order: string[] = [];
    const tick = (label: string, delayMs: number) => async () => {
      order.push(`start:${label}`);
      await new Promise((resolve) => {
        setTimeout(resolve, delayMs);
      });
      order.push(`end:${label}`);
    };

    const first = serializer.run('k', tick('1', FIRST_RUN_DELAY_MS));
    const second = serializer.run('k', tick('2', SHORT_RUN_DELAY_MS));

    // Second run for the same key must not start before the first finishes
    expect(order).toEqual(['start:1']);

    // A different key runs concurrently with the first
    const other = serializer.run('other', tick('other', SHORT_RUN_DELAY_MS));
    await other;
    expect(order).toContain('start:other');
    expect(order).toContain('end:other');

    await Promise.all([first, second]);
    expect(order).toEqual(['start:1', 'start:other', 'end:other', 'end:1', 'start:2', 'end:2']);
  });

  test('a failed prior run does not reject the following queued run', async () => {
    const serializer = createEventRunSerializer();
    const executed: string[] = [];

    const failing = serializer.run('k', async () => {
      executed.push('failing');
      throw new Error('prior run failed');
    });
    const following = serializer.run('k', async () => {
      executed.push('following');
    });

    await expect(failing).rejects.toThrow('prior run failed');
    await expect(following).resolves.toBeUndefined();
    expect(executed).toEqual(['failing', 'following']);
    expect(serializer.has('k')).toBe(false);
  });
});

describe('event-run-serializer (duplicate dropping)', () => {
  test('supports the duplicate-drop pattern used by the wrapper host event handler', async () => {
    const serializer = createEventRunSerializer();
    const executed: string[] = [];

    const runDeduped = async (label: string): Promise<void> => {
      if (serializer.has('session.idle')) return;
      await serializer.run('session.idle', async () => {
        executed.push(label);
        await new Promise((resolve) => {
          setTimeout(resolve, DUPLICATE_DROP_DELAY_MS);
        });
      });
    };

    const first = runDeduped('first');
    const second = runDeduped('second-dropped');
    const third = runDeduped('third-dropped');
    await Promise.all([first, second, third]);

    expect(executed).toEqual(['first']);
  });
});
