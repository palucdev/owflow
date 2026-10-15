import { createInProcessRunner, createSubprocessRunner } from "./runners.js";
import type { HookRunner, InProcessRunner } from "./runners.js";
import type { EnvelopeContext, HookRegistryEntry } from "./types.js";

export interface ExecutionCoreOptions {
  /** Host project directory used as the subprocess `cwd` (A5). */
  readonly cwd: string;
  readonly inProcess?: InProcessRunner;
  readonly subprocess?: HookRunner;
}

/**
 * The v2 seam: `run(entry, envelope) → Outcome` over both runner classes
 * (R11.1). `load` is registration-time import validation, deliberately kept
 * off the `run` path so the seam signature stays exactly `(entry, envelope)`.
 */
export interface ExecutionCore extends HookRunner {
  readonly load: (entries: readonly HookRegistryEntry[]) => Promise<void>;
}

export const createExecutionCore = (
  options: ExecutionCoreOptions,
): ExecutionCore => {
  const inProcess = options.inProcess ?? createInProcessRunner();
  const subprocess =
    options.subprocess ?? createSubprocessRunner({ cwd: options.cwd });

  return {
    load: async (entries) => {
      for (const entry of entries) {
        if (entry.runnerClass === "in-process") await inProcess.load(entry);
      }
    },
    run: (entry: HookRegistryEntry, envelope: EnvelopeContext) =>
      entry.runnerClass === "in-process"
        ? inProcess.run(entry, envelope)
        : subprocess.run(entry, envelope),
  };
};
