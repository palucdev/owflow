import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "yaml";
import {
  parseYamlFile,
  findStructuralErrors,
} from "./yaml-structure.js";

const UTIL_DIR = path.dirname(fileURLToPath(import.meta.url));

export interface ForkTaskInput {
  /** Root of all tasks, e.g. ".owflow/tasks" */
  taskRoot: string;
  /** Source task: absolute/relative path or a bare identifier resolved under <taskRoot>/research/ */
  source: string;
  /** Kebab-case slug derived by the agent, without date prefix */
  slug: string;
  /** Fork point: completed step slug up to which state + artifacts are kept */
  from: string;
  /** Directory containing orchestrator-state-research.yml (defaults to the plugins' own templates directory) */
  templatesPath?: string;
  /** Working directory used to resolve relative paths (defaults to process.cwd()) */
  cwd?: string;
}

export interface ForkTaskResult {
  forkPath: string;
  forkName: string;
  forkPoint: string;
  keptSteps: string[];
  droppedSteps: string[];
  excludedArtifacts: string[];
}

export interface ForkStepAssets {
  /** Dot-paths into the state that are reset to their template values when the step is dropped */
  stateResets: string[];
  /** Task-directory-relative paths (files or directories) excluded from the copy */
  artifacts: string[];
}

/** Canonical research step slugs in pipeline order (mirrors templates/orchestrator-state-research.yml auto_fix_attempts). */
export const RESEARCH_STEP_ORDER = [
  "brief-written",
  "plan-created",
  "findings-gathered",
  "synthesis-complete",
  "alternatives-generated",
  "approaches-chosen",
  "design-generated",
  "research-completed",
] as const;

export type ResearchStepSlug = (typeof RESEARCH_STEP_ORDER)[number];

/**
 * Fork contract: what each dropped research step takes with it.
 * - state fields are reset to their template values (prevents downstream
 *   skip/resume adoption of pre-fork results — e.g. research-converge's
 *   per-area partial resume reading phase_summaries.converge.decision_areas)
 * - artifacts are excluded from the copy (the source keeps them; the fork starts clean)
 */
export const RESEARCH_STEP_ASSETS: Record<ResearchStepSlug, ForkStepAssets> = {
  "brief-written": {
    stateResets: [
      "research_context.research_question",
      "research_context.research_type",
      "research_context.scope.included",
      "research_context.scope.excluded",
      "research_context.scope.constraints",
    ],
    artifacts: ["planning/research-brief.md"],
  },
  "plan-created": {
    stateResets: [
      "research_context.methodology",
      "research_context.sources",
      "research_context.phase_summaries.plan",
    ],
    artifacts: ["planning/research-plan.md", "planning/sources.md"],
  },
  "findings-gathered": {
    stateResets: [
      "research_context.gathering_strategy.categories",
      "research_context.gathering_strategy.count",
      "research_context.gathering_strategy.source",
      "research_outputs.findings_directory",
      "research_context.phase_summaries.gather",
    ],
    artifacts: ["analysis/findings"],
  },
  "synthesis-complete": {
    stateResets: [
      "research_context.confidence_level",
      "research_context.phase_summaries.synthesize",
      "research_outputs.synthesis",
      "research_outputs.research_report",
    ],
    artifacts: ["analysis/synthesis.md", "outputs/research-report.md"],
  },
  "alternatives-generated": {
    stateResets: [
      "research_context.phase_summaries.brainstorm",
      "research_outputs.solution_exploration",
    ],
    artifacts: ["outputs/solution-exploration.md"],
  },
  "approaches-chosen": {
    stateResets: [
      "research_context.phase_summaries.converge.summary",
      "research_context.phase_summaries.converge.decision_areas",
      "research_context.phase_summaries.converge.deferred_ideas",
    ],
    artifacts: [],
  },
  "design-generated": {
    stateResets: [
      "research_context.phase_summaries.design.summary",
      "research_context.phase_summaries.design.architecture_style",
      "research_context.phase_summaries.design.decisions_count",
      "research_outputs.high_level_design",
      "research_outputs.decision_log",
    ],
    artifacts: ["outputs/high-level-design.md", "outputs/decision-log.md"],
  },
  "research-completed": {
    stateResets: [],
    artifacts: [],
  },
};

/** Lowercase kebab-case, exactly 3-5 words of [a-z0-9] (Task Name Generation convention). */
export const RESEARCH_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+){2,4}$/;

/** Fork point must precede completion — research-completed has nothing to diverge into. */
export const FORK_TERMINAL_STEP: ResearchStepSlug = "research-completed";

const asStringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

const toPosix = (p: string): string => p.split(path.sep).join("/");

const utcTimestamp = (d: Date): string =>
  d.toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * Resolves a value at a dot path inside an object; undefined when the path
 * does not exist or passes through a non-object node.
 */
export const valueAtPath = (root: any, fieldPath: string): unknown => {
  let node = root;
  for (const part of fieldPath.split(".")) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return undefined;
    node = node[part];
  }
  return node;
};

/**
 * Deduplicated union of state-reset dot paths for the dropped steps.
 */
export const collectDroppedStateResets = (droppedSteps: string[]): string[] =>
  droppedSteps
    .flatMap(
      (slug) =>
        RESEARCH_STEP_ASSETS[slug as ResearchStepSlug]?.stateResets ?? [],
    )
    .filter((value, index, all) => all.indexOf(value) === index);

const setValueAtPath = (root: any, fieldPath: string, value: unknown): void => {
  const parts = fieldPath.split(".");
  let node = root;
  for (const part of parts.slice(0, -1)) {
    if (!node[part] || typeof node[part] !== "object") return;
    node = node[part];
  }
  const leaf = parts[parts.length - 1];
  if (leaf !== undefined) node[leaf] = value;
};

const walkFiles = (dir: string): string[] => {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir)) {
    const abs = path.join(dir, entry);
    if (fs.statSync(abs).isDirectory()) out.push(...walkFiles(abs));
    else out.push(abs);
  }
  return out;
};

/**
 * Validates the source task and fork point, copies the task while excluding
 * dropped-step artifacts, and rewrites the forked state file.
 */
export const forkResearchTask = (input: ForkTaskInput): ForkTaskResult => {
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

  const statePath = path.join(sourceDir, "orchestrator-state.yml");
  const parsedSourceState = parseYamlFile(statePath);
  if (!parsedSourceState.ok || !parsedSourceState.data) {
    throw new Error(
      `INVALID_SOURCE: ${parsedSourceState.error ?? `no orchestrator-state.yml in ${input.source}`}`,
    );
  }
  const sourceState = parsedSourceState.data;

  const completed = asStringList(
    sourceState?.orchestrator?.completed_phases,
  ).filter((slug) => (RESEARCH_STEP_ORDER as readonly string[]).includes(slug));

  if (completed.length === 0) {
    throw new Error(
      `INVALID_SOURCE: no completed research steps in ${input.source} (expected at least synthesis-complete).`,
    );
  }
  if (!completed.includes("synthesis-complete")) {
    throw new Error(
      "INVALID_SOURCE: forking requires synthesis-complete in completed_phases (forking half-baked research is not useful).",
    );
  }

  if (!(RESEARCH_STEP_ORDER as readonly string[]).includes(input.from)) {
    throw new Error(
      `UNKNOWN_STEP: ${input.from}. Valid fork points: ${RESEARCH_STEP_ORDER.filter((s) => s !== FORK_TERMINAL_STEP).join(", ")}`,
    );
  }
  if (input.from === FORK_TERMINAL_STEP) {
    throw new Error(
      `UNKNOWN_STEP: ${FORK_TERMINAL_STEP} is not a valid fork point — nothing diverges after completion. Valid fork points: ${completed.filter((s) => s !== FORK_TERMINAL_STEP).join(", ")}`,
    );
  }
  if (!completed.includes(input.from)) {
    throw new Error(
      `UNKNOWN_STEP: ${input.from} is not completed in the source task. Valid fork points (completed): ${completed.join(", ")}`,
    );
  }

  const forkPointIndex = RESEARCH_STEP_ORDER.indexOf(input.from as ResearchStepSlug);
  const droppedSteps = RESEARCH_STEP_ORDER.slice(forkPointIndex + 1).filter(
    (slug) => completed.includes(slug),
  );

  const forkName = `${new Date().toISOString().slice(0, 10)}-${input.slug}`;
  const forkPath = path.join(researchRoot, forkName);
  if (fs.existsSync(forkPath)) {
    throw new Error(
      `NAME_TAKEN: a research task directory "${forkName}" already exists. Hint: ask the user for another short descriptive name (3-5 words).`,
    );
  }

  // Paths NEVER created in the fork: dropped-step artifacts + the source state
  // file (the fork gets a freshly rewritten state instead).
  const excludedSourcePaths = new Set<string>([
    statePath,
    ...droppedSteps.flatMap(
      (slug) =>
        RESEARCH_STEP_ASSETS[slug as ResearchStepSlug].artifacts.map((rel) =>
          path.join(sourceDir, rel),
        ),
    ),
  ]);
  const isExcluded = (candidate: string): boolean =>
    [...excludedSourcePaths].some(
      (excluded) => candidate === excluded || candidate.startsWith(excluded + path.sep),
    );

  fs.cpSync(sourceDir, forkPath, {
    recursive: true,
    filter: (src) => !isExcluded(src),
  });

  // Rewrite the state from the in-memory source state (never the copied file)
  const templatePath = path.join(
    input.templatesPath
      ? path.resolve(cwd, input.templatesPath)
      : path.join(UTIL_DIR, "..", "templates"), // default: the plugin's own dist/templates
    "orchestrator-state-research.yml",
  );
  const parsedTemplate = parseYamlFile(templatePath);
  if (!parsedTemplate.ok || !parsedTemplate.data) {
    throw new Error(
      `Fork setup error: reference template orchestrator-state-research.yml is invalid or missing (${parsedTemplate.error ?? "not found"}).`,
    );
  }
  const forkState = structuredClone(sourceState);
  rewriteForkedState(forkState, {
    template: parsedTemplate.data,
    sourceDir,
    forkPath,
    forkPoint: input.from,
    forkPointIndex,
    completed,
    cwd,
  });

  const forkStatePath = path.join(forkPath, "orchestrator-state.yml");
  fs.writeFileSync(forkStatePath, yaml.stringify(forkState), "utf8");

  // Structural check against the same template the verify_template tool uses
  const structuralErrors = findStructuralErrors(
    parsedTemplate.data,
    parseYamlFile(forkStatePath).data,
  );
  if (structuralErrors.length > 0) {
    throw new Error(
      `Fork post-check failed. Forked state is missing the following required keys:\n- ${structuralErrors.join("\n- ")}`,
    );
  }

  const keptSteps = completed.filter((slug) => {
    const idx = RESEARCH_STEP_ORDER.indexOf(slug as ResearchStepSlug);
    return idx !== -1 && idx <= forkPointIndex;
  });

  return {
    forkPath,
    forkName,
    forkPoint: input.from,
    keptSteps,
    droppedSteps,
    excludedArtifacts: describeExcludedArtifacts(droppedSteps, sourceDir),
  };
};

const describeExcludedArtifacts = (
  droppedSteps: string[],
  sourceDir: string,
): string[] =>
  droppedSteps.flatMap((slug) =>
    RESEARCH_STEP_ASSETS[slug as ResearchStepSlug].artifacts.map((rel) => {
      const abs = path.join(sourceDir, rel);
      const isDir =
        fs.existsSync(abs) && fs.statSync(abs).isDirectory();
      return toPosix(rel) + (isDir ? "/" : "");
    }),
  );

function rewriteForkedState(
  forkState: any,
  ctx: {
    template: any;
    sourceDir: string;
    forkPath: string;
    forkPoint: string;
    forkPointIndex: number;
    completed: string[];
    cwd: string;
  },
): void {
  const { completed, forkPointIndex, forkPoint, sourceDir, forkPath, cwd, template } = ctx;
  const now = utcTimestamp(new Date());

  // Orchestrator bookkeeping — the fork is a new task at a known resume point
  forkState.orchestrator.started_phase = null;
  forkState.orchestrator.entry_point = "research-fork";
  forkState.orchestrator.completed_phases = completed.filter((slug) => {
    const idx = RESEARCH_STEP_ORDER.indexOf(slug as ResearchStepSlug);
    return idx !== -1 && idx <= forkPointIndex;
  });
  forkState.orchestrator.failed_phases = [];
  forkState.orchestrator.auto_fix_attempts = Object.fromEntries(
    RESEARCH_STEP_ORDER.map((slug) => [slug, 0]),
  );
  forkState.orchestrator.task_ids = {};
  forkState.orchestrator.created = now;
  forkState.orchestrator.updated = now;
  forkState.orchestrator.task_path = toPosix(path.relative(cwd, forkPath));
  forkState.orchestrator.options = {
    ...(forkState.orchestrator.options ?? {}),
    fork_information: {
      forked_from: toPosix(path.relative(cwd, sourceDir)),
      fork_point: forkPoint,
      forked_at: now,
      executed_steps: [...forkState.orchestrator.completed_phases],
    },
  };

  // Dropped-step state fields → template values
  const droppedSteps = RESEARCH_STEP_ORDER.slice(forkPointIndex + 1).filter(
    (slug) => completed.includes(slug),
  );
  for (const [fieldPath, templateValue] of resolveTemplateValues(
    template,
    collectDroppedStateResets(droppedSteps),
  )) {
    setValueAtPath(forkState, fieldPath, structuredClone(templateValue));
  }

  // A fork is an in-progress task again — even when research-completed was dropped
  forkState.task.status = "in_progress";
  forkState.task.title = `${forkState.task.title ?? "Research fork"} (fork of ${path.basename(sourceDir)})`;
}

/**
 * Resolves each state-reset dot path against the state template, producing
 * (path, templateValue) pairs — only paths the template actually defines.
 */
const resolveTemplateValues = (
  template: any,
  resets: string[],
): Array<[string, unknown]> =>
  resets.flatMap((fieldPath) => {
    const templateValue = valueAtPath(template, fieldPath);
    return templateValue === undefined
      ? []
      : [[fieldPath, templateValue] as [string, unknown]];
  });