import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";
import { parseYamlFile } from "./yaml-structure.js";

export interface ForkTaskInput {
  /** Root of all tasks, e.g. ".owflow/tasks" */
  taskRoot: string;
  /** Source task: absolute/relative path or a bare identifier resolved under <taskRoot>/research/ */
  source: string;
  /** Kebab-case slug derived by the agent, without date prefix */
  slug: string;
  /** Fork point: completed step slug up to which completed_phases are kept */
  from: string;
  /** Short description of what the fork should explore (stamped into the fork state) */
  intent?: string;
  /** Working directory used to resolve relative paths (defaults to process.cwd()) */
  cwd?: string;
}

export interface ForkTaskResult {
  forkPath: string;
  forkName: string;
  forkPoint: string;
}

/** Lowercase kebab-case, exactly 3-5 words of [a-z0-9] (Task Name Generation convention). */
export const RESEARCH_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+){2,4}$/;

const FORK_TERMINAL_STEP = "research-completed";

/**
 * Copies the whole source task directory into a new date-prefixed directory
 * named from the slug, then trims the copied state so the fork continues
 * from the fork point onwards. The source task is never modified.
 */
export const forkTask = (input: ForkTaskInput): ForkTaskResult => {
  const cwd = input.cwd ?? process.cwd();

  if (!input.slug || !RESEARCH_SLUG_PATTERN.test(input.slug)) {
    throw new Error(
      "INVALID_NAME: slug must be lowercase kebab-case, 3-5 words of [a-z0-9] (e.g. 'compare-caching-strategies')",
    );
  }

  const taskRoot = path.resolve(cwd, input.taskRoot);
  const researchRoot = path.join(taskRoot, "research");
  const sourceDir = [
    path.resolve(cwd, input.source),
    path.resolve(researchRoot, input.source),
  ].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isDirectory());
  if (sourceDir === undefined) {
    throw new Error(
      `INVALID_SOURCE: no task directory at ${input.source}. Hint: pass the task path or a directory name under .owflow/tasks/research/.`,
    );
  }
  if (!sourceDir.startsWith(researchRoot + path.sep)) {
    throw new Error(
      `INVALID_SOURCE: ${input.source} is not a research task directory under .owflow/tasks/research/.`,
    );
  }

  const parsedSourceState = parseYamlFile(path.join(sourceDir, "orchestrator-state.yml"));
  if (!parsedSourceState.ok || !parsedSourceState.data) {
    throw new Error(
      `INVALID_SOURCE: ${parsedSourceState.error ?? `no orchestrator-state.yml in ${input.source}`}`,
    );
  }
  const sourceState = parsedSourceState.data;
  const completed = Array.isArray(sourceState?.orchestrator?.completed_phases)
    ? sourceState.orchestrator.completed_phases.filter((s: unknown) => typeof s === "string")
    : [];

  if (input.from === FORK_TERMINAL_STEP) {
    throw new Error(
      `UNKNOWN_STEP: ${FORK_TERMINAL_STEP} is not a valid fork point — nothing diverges after completion.`,
    );
  }
  if (!completed.includes(input.from)) {
    throw new Error(
      `UNKNOWN_STEP: ${input.from} is not completed in the source task. Completed steps: ${completed.join(", ") || "none"}`,
    );
  }

  const forkName = `${new Date().toISOString().slice(0, 10)}-${input.slug}`;
  const forkPath = path.join(researchRoot, forkName);
  if (fs.existsSync(forkPath)) {
    throw new Error(
      `NAME_TAKEN: a research task directory "${forkName}" already exists. Hint: ask the user for another short descriptive name (3-5 words).`,
    );
  }

  fs.cpSync(sourceDir, forkPath, { recursive: true });

  const forkState = structuredClone(sourceState);
  forkState.orchestrator.started_phase = null;
  forkState.orchestrator.completed_phases = completed.slice(
    0,
    completed.indexOf(input.from) + 1,
  );
  forkState.orchestrator.entry_point = "research-fork";
  forkState.orchestrator.task_path = path
    .relative(cwd, forkPath)
    .split(path.sep)
    .join("/");
  forkState.orchestrator.options = {
    ...(forkState.orchestrator.options ?? {}),
    fork_information: {
      forked_from: path.basename(sourceDir),
      fork_point: input.from,
      forked_at: new Date().toISOString(),
      ...(input.intent ? { intent: input.intent } : {}),
    },
  };
  forkState.task = {
    ...forkState.task,
    status: "in_progress",
    title: `${forkState.task?.title ?? "Research task"} (fork of ${path.basename(sourceDir)})`,
  };
  fs.writeFileSync(
    path.join(forkPath, "orchestrator-state.yml"),
    yaml.stringify(forkState),
    "utf8",
  );

  return { forkPath, forkName, forkPoint: input.from };
};
