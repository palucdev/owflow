import { tool } from "@opencode-ai/plugin";
import path from "node:path";
import { forkResearchTask } from "../utils/fork-task.js";

export const fork_task = tool({
  description: "Fork a research task: copy it to a new task directory that diverges from the previous run at a chosen completed step (fork point). State fields and artifacts of dropped steps are reset/excluded; everything up to the fork point is kept.",
  args: {
    taskRoot: tool.schema.string().describe("Project-relative root of all tasks (typically '.owflow/tasks')"),
    source: tool.schema.string().describe("Source task path or identifier under .owflow/tasks/research/"),
    slug: tool.schema.string().describe("Lowercase-kebab-case slug for the fork name, 3-5 words, WITHOUT the date prefix (derived by the agent from a short descriptive name)"),
    from: tool.schema.string().describe("Fork point: a completed step slug from the source task's completed_phases (e.g. 'synthesis-complete'); everything after it is dropped"),
  },
  async execute(args, context) {
    try {
      const result = forkResearchTask({
        taskRoot: args.taskRoot,
        source: args.source,
        slug: args.slug,
        from: args.from,
        cwd: context.directory,
      });
      return {
        output: [
          `FORK CREATED`,
          `Fork path: ${path.relative(context.directory, result.forkPath).split(path.sep).join("/")}`,
          `Fork point: ${result.forkPoint}`,
          `Kept steps: ${result.keptSteps.join(", ") || "none"}`,
          `Dropped steps (state reset + artifacts not copied): ${result.droppedSteps.join(", ") || "none"}`,
          `Excluded artifacts: ${result.excludedArtifacts.join(", ") || "none"}`,
        ].join("\n"),
      };
    } catch (error: any) {
      return { output: error.message };
    }
  },
});
