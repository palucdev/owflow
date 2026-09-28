import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import yaml from "yaml";

import { fork_task } from "../../tools/fork_task.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "owflow-fork-tool-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const createSourceTask = (): string => {
  const source = path.join(
    tmpDir,
    ".owflow",
    "tasks",
    "research",
    "2026-01-01-source-task",
  );
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(
    path.join(source, "orchestrator-state.yml"),
    yaml.stringify({
      orchestrator: {
        started_phase: null,
        entry_point: "research",
        completed_phases: ["brief-written", "plan-created", "synthesis-complete"],
        failed_phases: [],
        auto_fix_attempts: {},
        options: {},
        created: "2026-01-01T00:00:00Z",
        updated: "2026-01-01T00:00:00Z",
        task_path: null,
        task_ids: {},
      },
      task: {
        title: "Title",
        description: null,
        status: "completed",
        tags: [],
        priority: null,
      },
      research_context: {
        research_type: "mixed",
        research_question: "Q?",
        scope: { included: [], excluded: [], constraints: [] },
        methodology: [],
        sources: [],
        confidence_level: "medium",
        gathering_strategy: { categories: [], count: 0, source: "default" },
        project_doc_paths: [],
        phase_summaries: {
          plan: { summary: null, steps_completed: [] },
          gather: { summary: null },
          synthesize: { summary: null },
          brainstorm: { summary: null },
          converge: { summary: null, decision_areas: [], deferred_ideas: [] },
          design: { summary: null, architecture_style: null, decisions_count: 0 },
        },
      },
      research_outputs: {
        research_report: "outputs/research-report.md",
        findings_directory: null,
        solution_exploration: null,
        high_level_design: null,
        decision_log: null,
        synthesis: null,
      },
    }),
    "utf8",
  );
  fs.writeFileSync(path.join(source, "keep-me.md"), "x", "utf8");
  return source;
};

const context = () => ({ directory: tmpDir }) as any;

const execute = (args: Record<string, string>) =>
  fork_task.execute(args as any, context());

describe("fork_task tool", () => {
  test("creates the fork and reports kept/dropped steps", async () => {
    createSourceTask();
    const result = await execute({
      taskRoot: ".owflow/tasks",
      source: "2026-01-01-source-task",
      slug: "diverge-cache-choice",
      from: "plan-created",
    });

    expect(result.output).toContain("FORK CREATED");
    expect(result.output).toContain("Fork point: plan-created");
    expect(result.output).toContain("Kept steps: brief-written, plan-created");
    expect(result.output).toContain("Dropped steps");
    expect(
      fs.existsSync(
        path.join(
          tmpDir,
          ".owflow",
          "tasks",
          "research",
          `${new Date().toISOString().slice(0, 10)}-diverge-cache-choice`,
        ),
      ),
    ).toBe(true);
  });

  test("reports tool errors as output instead of throwing", async () => {
    createSourceTask();
    const invalidName = await execute({
      taskRoot: ".owflow/tasks",
      source: "2026-01-01-source-task",
      slug: "Bad Slug",
      from: "plan-created",
    });
    expect(invalidName.output).toContain("INVALID_NAME");

    const badStep = await execute({
      taskRoot: ".owflow/tasks",
      source: "2026-01-01-source-task",
      slug: "diverge-cache-choice",
      from: "research-completed",
    });
    expect(badStep.output).toContain("UNKNOWN_STEP");
  });
});
