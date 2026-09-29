import { tool } from "@opencode-ai/plugin";
import path from "node:path";
import { forkTask } from "../utils/fork-task.js";

export const fork_task = tool({
  description:
    "Fork a research task: copy the whole source task directory into a new date-prefixed directory named from the slug, then trim the copied state so the fork continues from the chosen completed step (fork point) onwards. The source task is never modified.",
  args: {
    taskRoot: tool.schema.string().describe("Project-relative root of all tasks (typically '.owflow/tasks')"),
    source: tool.schema.string().describe("Source task path or identifier under .owflow/tasks/research/"),
    slug: tool.schema.string().describe("Lowercase-kebab-case slug for the fork name, 3-5 words, WITHOUT the date prefix (derived by the agent from a short descriptive name)"),
    from: tool.schema.string().describe("Fork point: a completed step slug from the source task's completed_phases (e.g. 'synthesis-complete'); the fork continues from the step after it"),
  },
  async execute(args, context) {
    try {
      const result = forkTask({
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
        ].join("\n"),
      };
    } catch (error: any) {
      return { output: error.message };
    }
  },
});
