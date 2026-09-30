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
  fs.mkdirSync(path.join(source, "analysis"), { recursive: true });
  fs.writeFileSync(path.join(source, "analysis", "synthesis.md"), "s", "utf8");
  return source;
};

const context = () => ({ directory: tmpDir }) as any;

const execute = async (args: Record<string, string>) => {
  const result = await fork_task.execute(args as any, context());
  if (typeof result === "string") {
    throw new Error(`expected a tool output object, got: ${result}`);
  }
  return result;
};

describe("fork_task tool", () => {
  test("creates the fork with a verbatim copy and trimmed state", async () => {
    createSourceTask();
    const result = await execute({
      taskRoot: ".owflow/tasks",
      source: "2026-01-01-source-task",
      slug: "diverge-cache-choice",
      from: "plan-created",
    });

    expect(result.output).toContain("FORK CREATED");
    expect(result.output).toContain("Fork point: plan-created");

    const forkDir = path.join(
      tmpDir,
      ".owflow",
      "tasks",
      "research",
      `${new Date().toISOString().slice(0, 10)}-diverge-cache-choice`,
    );
    expect(fs.existsSync(forkDir)).toBe(true);
    // verbatim copy — including the post-fork-point artifact
    expect(fs.existsSync(path.join(forkDir, "keep-me.md"))).toBe(true);
    expect(fs.existsSync(path.join(forkDir, "analysis", "synthesis.md"))).toBe(true);

    const state = yaml.parse(
      fs.readFileSync(path.join(forkDir, "orchestrator-state.yml"), "utf8"),
    );
    expect(state.orchestrator.completed_phases).toEqual(["brief-written", "plan-created"]);
    expect(state.task.status).toBe("in_progress");
    expect(state.task.title).toContain("(fork of 2026-01-01-source-task)");
  });

  test("passes the optional intent through to the fork state and output", async () => {
    createSourceTask();
    const result = await execute({
      taskRoot: ".owflow/tasks",
      source: "2026-01-01-source-task",
      slug: "diverge-cache-choice",
      from: "plan-created",
      intent: "re-synthesis from a different angle",
    });

    expect(result.output).toContain("Intent: re-synthesis from a different angle");

    const forkDir = path.join(
      tmpDir,
      ".owflow",
      "tasks",
      "research",
      `${new Date().toISOString().slice(0, 10)}-diverge-cache-choice`,
    );
    const state = yaml.parse(
      fs.readFileSync(path.join(forkDir, "orchestrator-state.yml"), "utf8"),
    );
    expect(state.orchestrator.options.fork_information.intent).toBe(
      "re-synthesis from a different angle",
    );
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
