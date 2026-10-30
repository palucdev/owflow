import { $ } from "bun";

import { tasksDirectory } from "../utils/workflow-paths.js";

/**
 * Post-compaction reminder.
 * Injects orchestrator state reminder into the compaction context so the
 * AI knows to re-read orchestrator-state.yml after the context is rebuilt.
 */
export const rereadOrchestratorState = async (
  directory: string,
  output: {
    context: string[];
    prompt?: string | undefined;
  },
): Promise<void> => {
  const tasksDir = tasksDirectory(directory);
  try {
    await $`test -d ${tasksDir}`;
    output.context.push(`## owflow Workflow State
If an orchestrator workflow was active before compaction, you MUST re-read
orchestrator-state.yml in that task's directory to verify completed_phases
and determine the next phase. Use the question tool at Phase Gates.`);
  } catch {
    // No tasks directory — not an owflow project, skip injection
  }
};
