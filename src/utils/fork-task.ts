import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';

import { RESEARCH_DIRECTORY_NAME, TASKS_DIRECTORY_NAME, workflowRelativePath } from './workflow-paths.js';
import { parseYamlFile } from './yaml-structure.js';

export interface ForkTaskInput {
  // Root of all tasks, e.g. the value of `workflowRelativePath(TASKS_DIRECTORY_NAME)`.
  taskRoot: string;
  // Source task: absolute/relative path or a bare identifier resolved under <taskRoot>/research/
  source: string;
  // Kebab-case slug derived by the agent, without date prefix
  slug: string;
  // Fork point: completed step slug up to which completed_phases are kept
  from: string;
  // Short description of what the fork should explore (stamped into the fork state)
  intent?: string;
  // Working directory used to resolve relative paths (defaults to process.cwd())
  cwd?: string;
}

export interface ForkTaskResult {
  forkPath: string;
  forkName: string;
  forkPoint: string;
}

// Lowercase kebab-case, exactly 3-5 words of [a-z0-9] (Task Name Generation convention).
export const RESEARCH_SLUG_PATTERN = /^[a-z0-9]+-[a-z0-9]+-[a-z0-9]+(?:-[a-z0-9]+)?(?:-[a-z0-9]+)?$/;

const FORK_TERMINAL_STEP = 'research-completed';
const ISO_DATE_LENGTH = 10;

interface ResolveSourceOptions {
  readonly input: ForkTaskInput;
  readonly cwd: string;
  readonly researchRoot: string;
}

const resolveSourceDirectory = (options: ResolveSourceOptions): string => {
  const { input, cwd, researchRoot } = options;
  const sourceDirectory = [
    path.resolve(cwd, input.source),
    path.resolve(researchRoot, input.source),
  ].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isDirectory());

  if (sourceDirectory === undefined) {
    const hintPath = workflowRelativePath(TASKS_DIRECTORY_NAME, RESEARCH_DIRECTORY_NAME);
    throw new Error(
      `INVALID_SOURCE: no task directory at ${input.source}. Hint: pass the task path or a directory name under ${hintPath}/.`,
    );
  }

  if (!sourceDirectory.startsWith(researchRoot + path.sep)) {
    const hintPath = workflowRelativePath(TASKS_DIRECTORY_NAME, RESEARCH_DIRECTORY_NAME);
    throw new Error(
      `INVALID_SOURCE: ${input.source} is not a research task directory under ${hintPath}/.`,
    );
  }

  return sourceDirectory;
};

const validateForkStep = (from: string, completedPhases: readonly string[]): void => {
  if (from === FORK_TERMINAL_STEP) {
    throw new Error(
      `UNKNOWN_STEP: ${FORK_TERMINAL_STEP} is not a valid fork point — nothing diverges after completion.`,
    );
  }
  if (completedPhases.includes(from)) {
    return;
  }
  const completedList = completedPhases.join(', ') || 'none';
  throw new Error(
    `UNKNOWN_STEP: ${from} is not completed in the source task. Completed steps: ${completedList}`,
  );
};

const loadSourceState = (
  sourceDirectory: string,
  inputSource: string,
): { sourceState: Record<string, unknown>; completedPhases: string[] } => {
  const parsedSourceState = parseYamlFile(path.join(sourceDirectory, 'orchestrator-state.yml'));
  if (!parsedSourceState.isOk || !parsedSourceState.data) {
    const errorDetails = parsedSourceState.error ?? `no orchestrator-state.yml in ${inputSource}`;
    throw new Error(`INVALID_SOURCE: ${errorDetails}`);
  }

  const sourceState = parsedSourceState.data as Record<string, unknown>;
  const orchestrator = sourceState['orchestrator'] as Record<string, unknown> | undefined;
  const rawCompleted = orchestrator?.['completed_phases'];
  const completedPhases = Array.isArray(rawCompleted)
    ? rawCompleted.filter((stepSlug: unknown): stepSlug is string => typeof stepSlug === 'string')
    : [];

  return { sourceState, completedPhases };
};

interface ForkStateContext {
  readonly sourceState: Record<string, unknown>;
  readonly completedPhases: readonly string[];
  readonly sourceDirectory: string;
  readonly forkPath: string;
  readonly from: string;
  readonly cwd: string;
  readonly intent?: string;
}

const buildForkState = (context: ForkStateContext): Record<string, unknown> => {
  const forkState = structuredClone(context.sourceState) as {
    orchestrator?: Record<string, unknown>;
    task?: Record<string, unknown>;
    [key: string]: unknown;
  };

  const orchestrator = forkState.orchestrator ?? {};
  const currentOptions = (orchestrator['options'] as Record<string, unknown> | undefined) ?? {};
  const relativeTaskPath = path.relative(context.cwd, context.forkPath).split(path.sep).join('/');
  const sourceBasename = path.basename(context.sourceDirectory);

  orchestrator['started_phase'] = JSON.parse('null');
  orchestrator['completed_phases'] = context.completedPhases.slice(
    0,
    context.completedPhases.indexOf(context.from) + 1,
  );
  orchestrator['entry_point'] = 'research-fork';
  orchestrator['task_path'] = relativeTaskPath;
  orchestrator['options'] = {
    ...currentOptions,
    fork_information: {
      forked_from: sourceBasename,
      fork_point: context.from,
      forked_at: new Date().toISOString(),
      ...(context.intent && { intent: context.intent }),
    },
  };
  forkState.orchestrator = orchestrator;

  const currentTask = forkState.task ?? {};
  const taskTitle = (currentTask['title'] as string | undefined) ?? 'Research task';
  forkState.task = {
    ...currentTask,
    status: 'in_progress',
    title: `${taskTitle} (fork of ${sourceBasename})`,
  };

  return forkState;
};

/**
Copies the whole source task directory into a new date-prefixed directory
named from the slug, then trims the copied state so the fork continues
from the fork point onwards. The source task is never modified.
*/
export const forkTask = (input: ForkTaskInput): ForkTaskResult => {
  const cwd = input.cwd ?? process.cwd();

  if (!input.slug || !RESEARCH_SLUG_PATTERN.test(input.slug)) {
    throw new Error(
      "INVALID_NAME: slug must be lowercase kebab-case, 3-5 words of [a-z0-9] (e.g. 'compare-caching-strategies')",
    );
  }

  const taskRoot = path.resolve(cwd, input.taskRoot);
  const researchRoot = path.join(taskRoot, 'research');
  const sourceDirectory = resolveSourceDirectory({ input, cwd, researchRoot });
  const { sourceState, completedPhases } = loadSourceState(sourceDirectory, input.source);

  validateForkStep(input.from, completedPhases);

  const forkName = `${new Date().toISOString().slice(0, ISO_DATE_LENGTH)}-${input.slug}`;
  const forkPath = path.join(researchRoot, forkName);
  if (fs.existsSync(forkPath)) {
    throw new Error(
      `NAME_TAKEN: a research task directory "${forkName}" already exists. Hint: ask the user for another short descriptive name (3-5 words).`,
    );
  }

  fs.cpSync(sourceDirectory, forkPath, { recursive: true });

  const forkState = buildForkState({
    sourceState,
    completedPhases,
    sourceDirectory,
    forkPath,
    from: input.from,
    cwd,
    ...(input.intent && { intent: input.intent }),
  });

  fs.writeFileSync(path.join(forkPath, 'orchestrator-state.yml'), yaml.stringify(forkState), 'utf8');

  return { forkPath, forkName, forkPoint: input.from };
};
