import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { rereadOrchestratorState } from "../../hooks/session-compaction.js";

describe("rereadOrchestratorState", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "owflow-compaction-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("should inject workflow state reminder when .owflow/tasks directory exists", async () => {
    const tasksDir = path.join(tmpDir, ".owflow", "tasks");
    fs.mkdirSync(tasksDir, { recursive: true });

    const output = { context: [] as string[] };
    await rereadOrchestratorState(tmpDir, output);

    expect(output.context).toHaveLength(1);
    expect(output.context[0]).toContain("## owflow Workflow State");
    expect(output.context[0]).toContain("orchestrator-state.yml");
    expect(output.context[0]).toContain("completed_phases");
  });

  test("should not inject workflow state reminder when .owflow/tasks directory does not exist", async () => {
    const output = { context: [] as string[] };
    await rereadOrchestratorState(tmpDir, output);

    expect(output.context).toHaveLength(0);
  });

  test("should append to existing context items without overwriting them", async () => {
    const tasksDir = path.join(tmpDir, ".owflow", "tasks");
    fs.mkdirSync(tasksDir, { recursive: true });

    const output = { context: ["existing context item"] };
    await rereadOrchestratorState(tmpDir, output);

    expect(output.context).toHaveLength(2);
    expect(output.context[0]).toBe("existing context item");
    expect(output.context[1]).toContain("## owflow Workflow State");
  });

  test("should leave output.prompt unmodified", async () => {
    const tasksDir = path.join(tmpDir, ".owflow", "tasks");
    fs.mkdirSync(tasksDir, { recursive: true });

    const output = { context: [], prompt: "initial prompt" };
    await rereadOrchestratorState(tmpDir, output);

    expect(output.prompt).toBe("initial prompt");
  });
});
