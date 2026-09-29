import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import yaml from "yaml";

import { forkTask, RESEARCH_SLUG_PATTERN } from "../../utils/fork-task.js";

let tmpDir: string;
let taskRoot: string;

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
      auto_fix_attempts: { "plan-created": 2 },
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
      tags: ["research"],
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
        converge: {
          summary: "converged",
          decision_areas: [
            { area: "cache-topology", chosen_approach: "write-through" },
          ],
          deferred_ideas: ["ttl-tuning"],
        },
        design: { summary: "designed", architecture_style: "layered", decisions_count: 3 },
      },
    },
    research_outputs: {
      research_report: "outputs/research-report.md",
      findings_directory: "analysis/findings",
      solution_exploration: "outputs/solution-exploration.md",
      high_level_design: "outputs/high-level-design.md",
      decision_log: "outputs/decision-log.md",
      synthesis: "analysis/synthesis.md",
    },
  };
};

const createSourceTask = (state: any): string => {
  const source = path.join(taskRoot, "research", "2026-01-01-source-task");
  fs.mkdirSync(source, { recursive: true });
  writeState(source, state);
  fs.mkdirSync(path.join(source, "planning"), { recursive: true });
  fs.writeFileSync(path.join(source, "planning", "research-brief.md"), "brief", "utf8");
  fs.writeFileSync(path.join(source, "planning", "research-plan.md"), "plan", "utf8");
  fs.writeFileSync(path.join(source, "planning", "sources.md"), "sources", "utf8");
  fs.mkdirSync(path.join(source, "analysis", "findings"), { recursive: true });
  fs.writeFileSync(path.join(source, "analysis", "findings", "codebase-cache.md"), "f", "utf8");
  fs.writeFileSync(path.join(source, "analysis", "synthesis.md"), "s", "utf8");
  fs.mkdirSync(path.join(source, "outputs"), { recursive: true });
  fs.writeFileSync(path.join(source, "outputs", "research-report.md"), "r", "utf8");
  fs.writeFileSync(path.join(source, "outputs", "solution-exploration.md"), "se", "utf8");
  fs.writeFileSync(path.join(source, "outputs", "high-level-design.md"), "hld", "utf8");
  fs.writeFileSync(path.join(source, "outputs", "decision-log.md"), "dl", "utf8");
  fs.writeFileSync(path.join(source, "stray-notes.txt"), "junk", "utf8");
  return source;
};

const readForkState = (forkPath: string): any =>
  yaml.parse(fs.readFileSync(path.join(forkPath, "orchestrator-state.yml"), "utf8"));

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "owflow-fork-test-"));
  taskRoot = path.join(tmpDir, ".owflow", "tasks");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const fork = (overrides: Partial<Parameters<typeof forkTask>[0]>) =>
  forkTask({
    taskRoot: path.join(".owflow", "tasks"),
    source: "2026-01-01-source-task",
    slug: "fork-cache-alternative",
    from: "synthesis-complete",
    cwd: tmpDir,
    ...overrides,
  });

describe("forkTask", () => {
  test("copies the whole source directory verbatim and trims completed_phases at the fork point", () => {
    const source = createSourceTask(baseState({}));
    const result = fork({});

    expect(result.forkPoint).toBe("synthesis-complete");
    expect(result.forkName).toBe(
      `${new Date().toISOString().slice(0, 10)}-fork-cache-alternative`,
    );
    expect(result.forkPath).toBe(path.join(taskRoot, "research", result.forkName));

    const forkPath = result.forkPath;
    expect(fs.existsSync(path.join(forkPath, "planning", "research-brief.md"))).toBe(true);
    expect(fs.existsSync(path.join(forkPath, "planning", "research-plan.md"))).toBe(true);
    expect(fs.existsSync(path.join(forkPath, "planning", "sources.md"))).toBe(true);
    expect(fs.existsSync(path.join(forkPath, "analysis", "findings", "codebase-cache.md"))).toBe(true);
    expect(fs.existsSync(path.join(forkPath, "analysis", "synthesis.md"))).toBe(true);
    expect(fs.existsSync(path.join(forkPath, "outputs", "research-report.md"))).toBe(true);
    expect(fs.existsSync(path.join(forkPath, "outputs", "solution-exploration.md"))).toBe(true);
    expect(fs.existsSync(path.join(forkPath, "outputs", "high-level-design.md"))).toBe(true);
    expect(fs.existsSync(path.join(forkPath, "outputs", "decision-log.md"))).toBe(true);
    expect(fs.existsSync(path.join(forkPath, "stray-notes.txt"))).toBe(true);

    // source untouched
    expect(fs.existsSync(path.join(source, "outputs", "solution-exploration.md"))).toBe(true);
    expect(fs.existsSync(path.join(source, "stray-notes.txt"))).toBe(true);

    const state = readForkState(forkPath);
    expect(state.orchestrator.completed_phases).toEqual([
      "brief-written",
      "plan-created",
      "findings-gathered",
      "synthesis-complete",
    ]);
    expect(state.orchestrator.started_phase).toBeNull();
    expect(state.orchestrator.task_path).toBe(`.owflow/tasks/research/${result.forkName}`);
    expect(state.task.status).toBe("in_progress");
    expect(state.task.title).toContain("(fork of 2026-01-01-source-task)");
  });

  test("state beyond the fork point is carried verbatim — the resumed step overwrites it", () => {
    createSourceTask(baseState({}));
    const result = fork({ from: "plan-created" });

    const state = readForkState(result.forkPath);
    expect(state.orchestrator.completed_phases).toEqual(["brief-written", "plan-created"]);
    expect(state.research_context.phase_summaries.converge.decision_areas).toHaveLength(1);
    expect(state.research_outputs.synthesis).toBe("analysis/synthesis.md");
    expect(fs.existsSync(path.join(result.forkPath, "analysis", "synthesis.md"))).toBe(true);
  });

  test("fork at design-generated keeps the full chain minus research-completed", () => {
    createSourceTask(baseState({}));
    const result = fork({ from: "design-generated" });

    const state = readForkState(result.forkPath);
    expect(state.orchestrator.completed_phases).toEqual([
      "brief-written",
      "plan-created",
      "findings-gathered",
      "synthesis-complete",
      "alternatives-generated",
      "approaches-chosen",
      "design-generated",
    ]);
  });

  test("source without synthesis-complete still forks at a completed step", () => {
    createSourceTask(
      baseState({
        completed: ["brief-written", "plan-created", "findings-gathered"],
        status: "in_progress",
      }),
    );
    const result = fork({ from: "findings-gathered" });

    expect(readForkState(result.forkPath).orchestrator.completed_phases).toEqual([
      "brief-written",
      "plan-created",
      "findings-gathered",
    ]);
  });

  test("identifier-only source resolves under .owflow/tasks/research/", () => {
    createSourceTask(baseState({}));
    const result = fork({});
    expect(fs.existsSync(result.forkPath)).toBe(true);
  });

  test("stamps fork_information with the intent, entry point and fork lineage", () => {
    createSourceTask(baseState({}));
    const result = fork({ intent: "compare caching strategies instead" });

    const state = readForkState(result.forkPath);
    expect(state.orchestrator.entry_point).toBe("research-fork");
    expect(state.orchestrator.options.fork_information).toEqual({
      forked_from: "2026-01-01-source-task",
      fork_point: "synthesis-complete",
      forked_at: expect.any(String),
      intent: "compare caching strategies instead",
    });
  });

  test("fork_information omits the intent when none is given and preserves existing options", () => {
    const sourceState = baseState({});
    sourceState.orchestrator.options = { spec_audit_enabled: false };
    createSourceTask(sourceState);
    const result = fork({});

    const state = readForkState(result.forkPath);
    expect(state.orchestrator.options.spec_audit_enabled).toBe(false);
    expect(state.orchestrator.options.fork_information).toEqual({
      forked_from: "2026-01-01-source-task",
      fork_point: "synthesis-complete",
      forked_at: expect.any(String),
    });
  });

  test("stamps fork_information when the source state has no options key", () => {
    const sourceState = baseState({});
    delete sourceState.orchestrator.options;
    createSourceTask(sourceState);
    const result = fork({ intent: "narrow the scope to mobile" });

    const state = readForkState(result.forkPath);
    expect(state.orchestrator.options.fork_information.intent).toBe(
      "narrow the scope to mobile",
    );
  });

  test("UNKNOWN_STEP: invalid slug, terminal step, and non-completed slug all blocked", () => {
    createSourceTask(baseState({}));

    expect(() => fork({ from: "bogus-slug" })).toThrow(/UNKNOWN_STEP/);
    expect(() => fork({ from: "research-completed" })).toThrow(/UNKNOWN_STEP/);

    // not completed in the source
    writeState(
      path.join(taskRoot, "research", "2026-01-01-source-task"),
      baseState({
        completed: [
          "brief-written",
          "plan-created",
          "findings-gathered",
          "synthesis-complete",
        ],
      }),
    );
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

  test("INVALID_SOURCE: missing dir, non-research dir, missing state", () => {
    createSourceTask(baseState({}));

    expect(() => fork({ source: "2026-01-01-does-not-exist" })).toThrow(
      /INVALID_SOURCE/,
    );

    // non-research location
    const devTask = path.join(taskRoot, "development", "2026-01-01-dev-task");
    fs.mkdirSync(devTask, { recursive: true });
    writeState(devTask, baseState({}));
    expect(() => fork({ source: path.join(devTask) })).toThrow(/INVALID_SOURCE/);

    // directory without a state file
    const emptyTask = path.join(taskRoot, "research", "2026-01-01-empty-task");
    fs.mkdirSync(emptyTask, { recursive: true });
    expect(() => fork({ source: "2026-01-01-empty-task" })).toThrow(
      /INVALID_SOURCE/,
    );
  });
});

describe("slug pattern", () => {
  test("matches Task Name Generation shape", () => {
    expect(RESEARCH_SLUG_PATTERN.test("compare-caching-strategies")).toBe(true);
    expect(RESEARCH_SLUG_PATTERN.test("fork-cache-alternative")).toBe(true);
    expect(RESEARCH_SLUG_PATTERN.test("Too-Caps")).toBe(false);
    expect(RESEARCH_SLUG_PATTERN.test("short")).toBe(false);
    expect(RESEARCH_SLUG_PATTERN.test("a-b-c-d-e-f")).toBe(false);
  });
});
