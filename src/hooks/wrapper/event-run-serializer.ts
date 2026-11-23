export interface EventRunSerializer {
  has(key: string): boolean;
  run(key: string, task: () => Promise<void>): Promise<void>;
}

interface QueuedEventRun {
  readonly key: string;
  readonly version: number;
  readonly previous?: Promise<void>;
  readonly task: () => Promise<void>;
}

export const createEventRunSerializer = (): EventRunSerializer => {
  const tails = new Map<string, Promise<void>>();
  const versions = new Map<string, number>();

  const executeTask = async (queuedRun: QueuedEventRun): Promise<void> => {
    if (queuedRun.previous) {
      try {
        await queuedRun.previous;
      } catch {
        // Prior task failures are reported to their own callers.
      }
    }
    try {
      await queuedRun.task();
    } finally {
      if (versions.get(queuedRun.key) === queuedRun.version) {
        tails.delete(queuedRun.key);
        versions.delete(queuedRun.key);
      }
    }
  };

  return {
    has: (key) => tails.has(key),
    run: (key, task) => {
      const version = (versions.get(key) ?? 0) + 1;
      versions.set(key, version);
      const completion = executeTask({ key, version, previous: tails.get(key), task });
      tails.set(key, completion);
      return completion;
    },
  };
};
