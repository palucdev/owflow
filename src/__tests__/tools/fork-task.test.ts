import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

import { fork_task } from '../../tools/fork-task.js';
import { createSourceTask, createForkWorkspaceHarness, ISO_DATE_LENGTH, makeSourceTaskState, readForkState } from '../utils/fork-task-fixtures.js';
import { createToolContext, outputOf } from '../fixtures/tools/tool-test-harness.js';

type ForkToolArguments = Parameters<typeof fork_task.execute>[0];

const workspaceHarness = createForkWorkspaceHarness();

beforeEach(() => {
  workspaceHarness.setup();
});

afterEach(() => {
  workspaceHarness.teardown();
});

const forkArguments = {
  taskRoot: '.owflow/tasks',
  source: '2026-01-01-source-task',
  slug: 'diverge-cache-choice',
  from: 'plan-created',
} as const;

const executeForkTool = async (directory: string, overrides: Partial<ForkToolArguments>): Promise<string> =>
  outputOf(await fork_task.execute({ ...forkArguments, ...overrides }, createToolContext(directory)));

test('creates the fork with a verbatim copy and trimmed state', async () => {
  const workspace = workspaceHarness.workspace();
  createSourceTask(workspace, makeSourceTaskState());

  const output = await executeForkTool(workspace.temporaryDirectory, {});

  expect(output).toContain('FORK CREATED');
  expect(output).toContain('Fork point: plan-created');

  const forkDirectory = path.join(workspace.taskRoot, 'research', `${new Date().toISOString().slice(0, ISO_DATE_LENGTH)}-diverge-cache-choice`);
  expect(fs.existsSync(forkDirectory)).toBe(true);
  // verbatim copy — including the post-fork-point artifact
  expect(fs.existsSync(path.join(forkDirectory, 'stray-notes.txt'))).toBe(true);
  expect(fs.existsSync(path.join(forkDirectory, 'analysis', 'synthesis.md'))).toBe(true);

  const state = readForkState(forkDirectory);
  expect(state.orchestrator.completed_phases).toEqual(['brief-written', 'plan-created']);
  expect(state.task.status).toBe('in_progress');
  expect(state.task.title).toContain('(fork of 2026-01-01-source-task)');
});

test('passes the optional intent through to the fork state and output', async () => {
  const workspace = workspaceHarness.workspace();
  createSourceTask(workspace, makeSourceTaskState());

  const output = await executeForkTool(workspace.temporaryDirectory, { intent: 're-synthesis from a different angle' });

  expect(output).toContain('Intent: re-synthesis from a different angle');

  const forkDirectory = path.join(workspace.taskRoot, 'research', `${new Date().toISOString().slice(0, ISO_DATE_LENGTH)}-diverge-cache-choice`);
  const state = readForkState(forkDirectory);
  expect(state.orchestrator.options.fork_information.intent).toBe('re-synthesis from a different angle');
});

test('reports tool errors as output instead of throwing', async () => {
  const workspace = workspaceHarness.workspace();
  createSourceTask(workspace, makeSourceTaskState());

  const invalidName = await executeForkTool(workspace.temporaryDirectory, { slug: 'Bad Slug' });
  expect(invalidName).toContain('INVALID_NAME');

  const badStep = await executeForkTool(workspace.temporaryDirectory, { from: 'research-completed' });
  expect(badStep).toContain('UNKNOWN_STEP');
});
