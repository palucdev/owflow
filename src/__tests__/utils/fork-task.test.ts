import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import yaml from "yaml";

import {
  forkResearchTask,
  collectDroppedStateResets,
  RESEARCH_STEP_ORDER,
  RESEARCH_STEP_ASSETS,
  RESEARCH_SLUG_PATTERN,
} from "../../utils/fork-task.js";

let tmpDir: string;
let taskRoot: string;
let templatesPath: string;

const writeState = (dir: string, state: any): void => {
  fs.mkdirSync(path.dirname(path.join(dir, "orchestrator-state.yml")), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(dir, "orchestrator-state.yml"),
    yaml.stringify(state),
    "utf8",
  );
};

const baseState = (overrides: {
  completed?: string[];
  status?: string;
  title?: string;
  entryPoint?: string;
  converge?: any;
  outputs?: any;
}) => {
  const completed = overrides.completed ?? [
    "brief-written",
    "plan-created",
    "findings-gathered",
    "synthesis-complete",
    "alternatives-generated",
    "approaches-chosen",
    "design-generated",
    "research-completed",
  ];
  return {
    orchestrator: {
      started_phase: "research-completed",
      entry_point: overrides.entryPoint ?? "research",
      completed_phases: completed,
      failed_phases: ["plan-created"],
      auto_fix_attempts: Object.fromEntries(
        RESEARCH_STEP_ORDER.map((slug) => [slug, slug === "plan-created" ? 2 : 0]),
      ),
      options: {},
      created: "2026-01-01T00:00:00Z",
      updated: "2026-01-01T00:00:00Z",
      task_path: null,
      task_ids: { "research-plan": "t1" },
    },
    task: {
      title: overrides.title ?? "Evaluate caching strategies",
      description: "Research question",
      status: overrides.status ?? "completed",
      tags: [research_tag()],
      priority: "high",
    },
    research_context: {
      research_type: "mixed",
      research_question: "Which cache invalidation approach fits our API?",
      scope: { included: ["api"], excluded: [], constraints: [] },
      methodology: ["benchmark-driven"],
      sources: ["src/**"],
      confidence_level: "medium",
      gathering_strategy: {
        categories: ["codebase", "docs"],
        count: 2,
        source: "planner",
      },
      project_doc_paths: [],
      phase_summaries: {
        plan: { summary: "planned", steps_completed: [] },
        gather: { summary: "gathered" },
        synthesize: { summary: "synthesized" },
        brainstorm: { summary: "brainstormed" },
        converge: overrides.converge ?? {
          summary: "converged",
          decision_areas: [
            { area: "cache-topology", chosen_approach: "write-through" },
          ],
          deferred_ideas: ["ttl-tuning"],
        },
        design: { summary: "designed", architecture_style: "layered", decisions_count: 3 },
      },
    },
    research_outputs: overrides.outputs ?? {
      research_report: "outputs/research-report.md",
      findings_directory: "analysis/findings",
      solution_exploration: "outputs/solution-exploration.md",
      high_level_design: "outputs/high-level-design.md",
      decision_log: "outputs/decision-log.md",
      synthesis: "analysis/synthesis.md",
    },
  };
};

const research_tag = (): string => "research";

const createSourceTask = (state: any): string => {
  const source = path.join(taskRoot, "research", "2026-01-01-source-task");
  fs.mkdirSync(source, { recursive: true });
  writeState(source, state);
  // Keep-step artifacts
  fs.mkdirSync(path.join(source, "planning"), { recursive: true });
  fs.writeFileSync(path.join(source, "planning", "research-brief.md"), "brief", "utf8");
  fs.writeFileSync(path.join(source, "planning", "research-plan.md"), "plan", "utf8");
  fs.writeFileSync(path.join(source, "planning", "sources.md"), "sources", "utf8");
  // Dropped-step artifacts beyond synthesis
  fs.mkdirSync(path.join(source, "analysis", "findings"), { recursive: true });
  fs.writeFileSync(path.join(source, "analysis", "findings", "codebase-cache.md"), "f", "utf8");
  fs.writeFileSync(path.join(source, "analysis", "synthesis.md"), "s", "utf8");
  fs.mkdirSync(path.join(source, "outputs"), { recursive: true });
  fs.writeFileSync(path.join(source, "outputs", "research-report.md"), "r", "utf8");
  fs.writeFileSync(path.join(source, "outputs", "solution-exploration.md"), "se", "utf8");
  fs.writeFileSync(path.join(source, "outputs", "high-level-design.md"), "hld", "utf8");
  fs.writeFileSync(path.join(source, "outputs", "decision-log.md"), "dl", "utf8");
  return source;
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "owflow-fork-test-"));
  taskRoot = path.join(tmpDir, ".owflow", "tasks");
  templatesPath = path.resolve(__dirname, "../../templates");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const fork = (overrides: Partial<Parameters<typeof forkResearchTask>[0]>) =>
  forkResearchTask({
    taskRoot: path.join(".owflow", "tasks"),
    source: "2026-01-01-source-task",
    slug: "fork-cache-alternative",
    from: "synthesis-complete",
    templatesPath,
    cwd: tmpDir,
    ...overrides,
  });

describe("forkResearchTask", () => {
  test("fork at synthesis-complete keeps up-to-fork-point artifacts and drops the optional-chain ones", () => {
    const source = createSourceTask(baseState({}));
    const result = fork({});

    expect(result.forkPoint).toBe("synthesis-complete");
    expect(result.keptSteps).toEqual([
      "brief-written",
      "plan-created",
      "findings-gathered",
      "synthesis-complete",
    ]);
    expect(result.droppedSteps).toEqual([
      "alternatives-generated",
      "approaches-chosen",
      "design-generated",
      "research-completed",
    ]);
    expect(result.excludedArtifacts).toEqual([
      "outputs/solution-exploration.md",
      "outputs/high-level-design.md",
      "outputs/decision-log.md",
    ]);

    const forkPath = result.forkPath;
    // kept artifacts
    expect(fs.existsSync(path.join(forkPath, "planning", "research-brief.md"))).toBe(true);
    expect(fs.existsSync(path.join(forkPath, "planning", "research-plan.md"))).toBe(true);
    expect(fs.existsSync(path.join(forkPath, "planning", "sources.md"))).toBe(true);
    expect(fs.existsSync(path.join(forkPath, "analysis", "findings", "codebase-cache.md"))).toBe(true);
    expect(fs.existsSync(path.join(forkPath, "analysis", "synthesis.md"))).toBe(true);
    expect(fs.existsSync(path.join(forkPath, "outputs", "research-report.md"))).toBe(true);
    // dropped artifacts are NOT copied (no archive dir either)
    expect(fs.existsSync(path.join(forkPath, "outputs", "solution-exploration.md"))).toBe(false);
    expect(fs.existsSync(path.join(forkPath, "outputs", "high-level-design.md"))).toBe(false);
    expect(fs.existsSync(path.join(forkPath, "outputs", "decision-log.md"))).toBe(false);
    expect(fs.existsSync(path.join(forkPath, "_archive"))).toBe(false);
    // source untouched
    expect(fs.existsSync(path.join(source, "outputs", "solution-exploration.md"))).toBe(true);
  });

  test("forked state file: merged rewrite + dropped-step resets + template structure + preserved research-type", () => {
    createSourceTask(baseState({}));
    const result = fork({});

    const state = yaml.parse(
      fs.readFileSync(path.join(result.forkPath, "orchestrator-state.yml"), "utf8"),
    );

    expect(state.orchestrator.completed_phases).toEqual([
      "brief-written",
      "plan-created",
      "findings-gathered",
      "synthesis-complete",
    ]);
    expect(state.orchestrator.entry_point).toBe("research-fork");
    expect(state.orchestrator.started_phase).toBeNull();
    expect(state.orchestrator.task_path).toBe(result.forkPath.replace(/\\/g, "/").startsWith(tmpDir) ? path.relative(tmpDir, result.forkPath).split(path.sep).join("/") : state.orchestrator.task_path);
    expect(state.orchestrator.task_ids).toEqual({});
    expect(state.orchestrator.failed_phases).toEqual([]);
    expect(state.orchestrator.auto_fix_attempts).toEqual(
      Object.fromEntries(RESEARCH_STEP_ORDER.map((slug) => [slug, 0])),
    );
    expect(state.orchestrator.options.fork_information).toEqual({
      forked_from: ".owflow/tasks/research/2026-01-01-source-task",
      fork_point: "synthesis-complete",
      forked_at: expect.any(String),
      executed_steps: state.orchestrator.completed_phases,
    });
    expect(state.task.status).toBe("in_progress");
    expect(state.task.title).toContain("(fork of 2026-01-01-source-task)");

    // dropped-step state fields reset to template values
    expect(state.research_context.phase_summaries.brainstorm).toEqual({ summary: null });
    expect(state.research_context.phase_summaries.converge).toEqual({
      summary: null,
      decision_areas: [],
      deferred_ideas: [],
    });
    expect(state.research_context.phase_summaries.design).toEqual({
      summary: null,
      architecture_style: null,
      decisions_count: 0,
    });
    expect(state.research_outputs.solution_exploration).toBeNull();
    expect(state.research_outputs.high_level_design).toBeNull();
    expect(state.research_outputs.decision_log).toBeNull();

    // kept-step state fields preserved
    expect(state.research_context.research_type).toBe("mixed");
    expect(state.research_context.research_question).toBe(
      "Which cache invalidation approach fits our API?",
    );
    expect(state.research_context.gathering_strategy.count).toBe(2);
    expect(state.research_outputs.research_report).toBe("outputs/research-report.md");
  });

  test("fork at plan-created drops gather/synthesis/optional-chain state and artifacts", () => {
    createSourceTask(baseState({}));
    const result = fork({ from: "plan-created" });

    expect(result.droppedSteps).toEqual([
      "findings-gathered",
      "synthesis-complete",
      "alternatives-generated",
      "approaches-chosen",
      "design-generated",
      "research-completed",
    ]);
    expect(result.excludedArtifacts).toContain("analysis/findings/");
    expect(result.excludedArtifacts).toContain("analysis/synthesis.md");
    expect(result.excludedArtifacts).toContain("outputs/research-report.md");

    const state = yaml.parse(
      fs.readFileSync(path.join(result.forkPath, "orchestrator-state.yml"), "utf8"),
    );
    expect(state.orchestrator.completed_phases).toEqual(["brief-written", "plan-created"]);
    expect(state.research_context.gathering_strategy.categories).toEqual([]);
    expect(state.research_outputs.synthesis).toBeNull();
    expect(fs.existsSync(path.join(result.forkPath, "analysis", "findings"))).toBe(false);
    expect(fs.existsSync(path.join(result.forkPath, "analysis", "synthesis.md"))).toBe(false);
  });

  test("late fork at design-generated keeps ALL artifacts including design outputs", () => {
    createSourceTask(baseState({}));
    const result = fork({ from: "design-generated" });

    expect(result.droppedSteps).toEqual(["research-completed"]);
    expect(result.excludedArtifacts).toEqual([]);
    const state = yaml.parse(
      fs.readFileSync(path.join(result.forkPath, "orchestrator-state.yml"), "utf8"),
    );
    expect(state.orchestrator.completed_phases).toEqual([
      "brief-written",
      "plan-created",
      "findings-gathered",
      "synthesis-complete",
      "alternatives-generated",
      "approaches-chosen",
      "design-generated",
    ]);
    // converge decisions were kept (chosen_approach intact for the design lineage)
    expect(state.research_context.phase_summaries.converge.decision_areas).toHaveLength(1);
    expect(state.research_outputs.decision_log).toBe("outputs/decision-log.md");
    expect(fs.existsSync(path.join(result.forkPath, "outputs", "decision-log.md"))).toBe(true);
  });

  test("fork at alternatives-generated resets converge AND design state but keeps brainstorm artifact", () => {
    createSourceTask(baseState({}));
    const result = fork({ from: "alternatives-generated" });

    const state = yaml.parse(
      fs.readFileSync(path.join(result.forkPath, "orchestrator-state.yml"), "utf8"),
    );
    expect(state.orchestrator.completed_phases).toEqual([
      "brief-written",
      "plan-created",
      "findings-gathered",
      "synthesis-complete",
      "alternatives-generated",
    ]);
    expect(state.research_context.phase_summaries.converge.decision_areas).toEqual([]);
    expect(state.research_outputs.solution_exploration).toBe(
      "outputs/solution-exploration.md",
    );
    expect(fs.existsSync(path.join(result.forkPath, "outputs", "solution-exploration.md"))).toBe(true);
    expect(fs.existsSync(path.join(result.forkPath, "outputs", "high-level-design.md"))).toBe(false);
  });

  test("fork on a fresh-looking source (no artifacts for dropped steps) still succeeds", () => {
    createSourceTask(
      baseState({
        completed: [
          "brief-written",
          "plan-created",
          "findings-gathered",
          "synthesis-complete",
        ],
        status: "in_progress",
      }),
    );
    const result = fork({});
    expect(result.droppedSteps).toEqual([]);
    expect(result.excludedArtifacts).toEqual([]);
  });

  test("identifier-only source resolves under .owflow/tasks/research/", () => {
    createSourceTask(baseState({}));
    const result = fork({});
    expect(fs.existsSync(result.forkPath)).toBe(true);
  });

  test("UNKNOWN_STEP: invalid slug and non-completed slug both blocked", () => {
    createSourceTask(baseState({}));

    expect(() => fork({ from: "bogus-slug" })).toThrow(/UNKNOWN_STEP/);
    // plan-created completed? yes — but research-completed always invalid
    expect(() => fork({ from: "research-completed" })).toThrow(/UNKNOWN_STEP/);
    // not completed in source
    const source = path.join(taskRoot, "research", "2026-01-01-source-task");
    const state = baseState({
      completed: [
        "brief-written",
        "plan-created",
        "findings-gathered",
        "synthesis-complete",
      ],
    });
    writeState(source, state);
    expect(() => fork({ from: "alternatives-generated" })).toThrow(/UNKNOWN_STEP/);
  });

  test("NAME_TAKEN and INVALID_NAME rejected; fork not created", () => {
    createSourceTask(baseState({}));
    fork({});
    expect(() => fork({})).toThrow(/NAME_TAKEN/);
    expect(() => fork({ slug: "Too-Caps" })).toThrow(/INVALID_NAME/);
    expect(() => fork({ slug: "short" })).toThrow(/INVALID_NAME/);
    expect(() => fork({ slug: "way-too-many-words-for-a-slug-here" })).toThrow(
      /INVALID_NAME/,
    );
  });

  test("INVALID_SOURCE: missing dir, non-research dir, missing state, no synthesis", () => {
    createSourceTask(baseState({}));

    expect(() => fork({ source: "2026-01-01-does-not-exist" })).toThrow(
      /INVALID_SOURCE/,
    );

    // non-research location
    const devTask = path.join(taskRoot, "development", "2026-01-01-dev-task");
    fs.mkdirSync(devTask, { recursive: true });
    writeState(devTask, baseState({}));
    expect(() => fork({ source: path.join(devTask) })).toThrow(/INVALID_SOURCE/);

    // directory without a state file (extra dir under research/ is fine for
    // path resolution, but state check must fail)
    const emptyTask = path.join(taskRoot, "research", "2026-01-01-empty-task");
    fs.mkdirSync(emptyTask, { recursive: true });
    expect(() => fork({ source: "2026-01-01-empty-task" })).toThrow(
      /INVALID_SOURCE/,
    );

    // completed without synthesis-complete
    const halfTask = path.join(taskRoot, "research", "2026-01-01-half-task");
    fs.mkdirSync(halfTask, { recursive: true });
    writeState(
      halfTask,
      baseState({ completed: ["brief-written", "plan-created", "findings-gathered"] }),
    );
    expect(() => fork({ source: "2026-01-01-half-task" })).toThrow(
      /INVALID_SOURCE.*synthesis-complete/,
    );
  });
});

describe("fork contract helpers", () => {
  test("collectDroppedStateResets deduplicates and honors the full dropped chain", () => {
    const resets = collectDroppedStateResets([
      "alternatives-generated",
      "approaches-chosen",
      "design-generated",
      "research-completed",
    ]);
    expect(resets).toContain("research_context.phase_summaries.brainstorm");
    expect(resets).toContain("research_context.phase_summaries.converge.decision_areas");
    expect(resets).toContain("research_outputs.decision_log");
    const unique = new Set(resets);
    expect(unique.size).toBe(resets.length);
  });

  test("step assets cover every research step", () => {
    for (const slug of RESEARCH_STEP_ORDER) {
      expect(RESEARCH_STEP_ASSETS[slug]).toBeDefined();
      expect(Array.isArray(RESEARCH_STEP_ASSETS[slug].stateResets)).toBe(true);
      expect(Array.isArray(RESEARCH_STEP_ASSETS[slug].artifacts)).toBe(true);
    }
  });

  test("slug pattern matches Task Name Generation shape", () => {
    expect(RESEARCH_SLUG_PATTERN.test("compare-caching-strategies")).toBe(true);
    expect(RESEARCH_SLUG_PATTERN.test("fork-cache-alternative")).toBe(true);
    expect(RESEARCH_SLUG_PATTERN.test("Too-Caps")).toBe(false);
    expect(RESEARCH_SLUG_PATTERN.test("short")).toBe(false);
    expect(RESEARCH_SLUG_PATTERN.test("a-b-c-d-e-f")).toBe(false);
  });
});
