import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { rereadOrchestratorState } from '../../../hooks/internal/session-compaction.js';

const workspace = { directory: '' };

const EXPECTED_CONTEXT_WITH_EXISTING_ITEM = 2;

beforeEach(() => {
  workspace.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'owflow-compaction-test-'));
});

afterEach(() => {
  if (fs.existsSync(workspace.directory)) {
    fs.rmSync(workspace.directory, { recursive: true, force: true });
  }
});

const createTasksDirectory = (): string => {
  const tasksDirectory = path.join(workspace.directory, '.owflow', 'tasks');
  fs.mkdirSync(tasksDirectory, { recursive: true });
  return tasksDirectory;
};

describe('rereadOrchestratorState reminder injection', () => {
  test('should inject workflow state reminder when .owflow/tasks directory exists', async () => {
    createTasksDirectory();

    const output = { context: [] as string[] };
    await rereadOrchestratorState(workspace.directory, output);

    expect(output.context).toHaveLength(1);
    expect(output.context[0]).toContain('## owflow Workflow State');
    expect(output.context[0]).toContain('orchestrator-state.yml');
    expect(output.context[0]).toContain('completed_phases');
  });

  test('should not inject workflow state reminder when .owflow/tasks directory does not exist', async () => {
    const output = { context: [] as string[] };
    await rereadOrchestratorState(workspace.directory, output);

    expect(output.context).toHaveLength(0);
  });
});

describe('rereadOrchestratorState context preservation', () => {
  test('should append to existing context items without overwriting them', async () => {
    createTasksDirectory();

    const output = { context: ['existing context item'] };
    await rereadOrchestratorState(workspace.directory, output);

    expect(output.context).toHaveLength(EXPECTED_CONTEXT_WITH_EXISTING_ITEM);
    expect(output.context[0]).toBe('existing context item');
    expect(output.context[1]).toContain('## owflow Workflow State');
  });

  test('should leave output.prompt unmodified', async () => {
    createTasksDirectory();

    const output = { context: [], prompt: 'initial prompt' };
    await rereadOrchestratorState(workspace.directory, output);

    expect(output.prompt).toBe('initial prompt');
  });
});
