import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { rereadOrchestratorState } from '../../../hooks/internal/session-compaction.js';
import { removeScratchDirectory } from '../../fixtures/hooks/scratch-cleanup.js';

const EXPECTED_CONTEXT_WITH_EXISTING_ITEM = 2;
const SCRATCH_ROOT = path.join(process.cwd(), '.test-scratch', 'session-compaction');

fs.rmSync(SCRATCH_ROOT, { recursive: true, force: true });
fs.mkdirSync(SCRATCH_ROOT, { recursive: true });

afterAll(() => {
  removeScratchDirectory(SCRATCH_ROOT);
});

describe('rereadOrchestratorState', () => {
  test('should inject workflow state reminder when .owflow/tasks directory exists', async () => {
    const root = path.join(SCRATCH_ROOT, 'reminder-injected');
    fs.mkdirSync(path.join(root, '.owflow', 'tasks'), { recursive: true });

    const output = { context: [] as string[] };
    await rereadOrchestratorState(root, output);

    expect(output.context).toHaveLength(1);
    expect(output.context[0]).toContain('## owflow Workflow State');
    expect(output.context[0]).toContain('orchestrator-state.yml');
    expect(output.context[0]).toContain('completed_phases');
  });

  test('should not inject workflow state reminder when .owflow/tasks directory does not exist', async () => {
    const output = { context: [] as string[] };
    await rereadOrchestratorState(path.join(SCRATCH_ROOT, 'no-tasks'), output);

    expect(output.context).toHaveLength(0);
  });

  test('should append to existing context items without overwriting them', async () => {
    const root = path.join(SCRATCH_ROOT, 'existing-context');
    fs.mkdirSync(path.join(root, '.owflow', 'tasks'), { recursive: true });

    const output = { context: ['existing context item'] };
    await rereadOrchestratorState(root, output);

    expect(output.context).toHaveLength(EXPECTED_CONTEXT_WITH_EXISTING_ITEM);
    expect(output.context[0]).toBe('existing context item');
    expect(output.context[1]).toContain('## owflow Workflow State');
  });

  test('should leave output.prompt unmodified', async () => {
    const root = path.join(SCRATCH_ROOT, 'prompt-untouched');
    fs.mkdirSync(path.join(root, '.owflow', 'tasks'), { recursive: true });

    const output = { context: [], prompt: 'initial prompt' };
    await rereadOrchestratorState(root, output);

    expect(output.prompt).toBe('initial prompt');
  });
});
