export interface SerializedTaskQueue {
  has(key: string): boolean;
  run(key: string, task: () => Promise<void>): Promise<void>;
}

interface SerializedTask {
  readonly key: string;
  readonly version: number;
  readonly previous?: Promise<void>;
  readonly task: () => Promise<void>;
}

export const createSerializedTaskQueue = (): SerializedTaskQueue => {
  const tails = new Map<string, Promise<void>>();
  const versions = new Map<string, number>();

  const executeTask = async (serializedTask: SerializedTask): Promise<void> => {
    if (serializedTask.previous) {
      try {
        await serializedTask.previous;
      } catch {
        // Prior task failures are reported to their own callers.
      }
    }
    try {
      await serializedTask.task();
    } finally {
      if (versions.get(serializedTask.key) === serializedTask.version) {
        tails.delete(serializedTask.key);
        versions.delete(serializedTask.key);
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
