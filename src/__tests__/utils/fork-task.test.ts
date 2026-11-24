import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

import { createForkWorkspaceHarness, createSourceTask, forkFromSource, ISO_DATE_LENGTH, makeOrchestratorSection, makeSourceTaskState, readForkState } from './fork-task-fixtures.js';

const workspaceHarness = createForkWorkspaceHarness();

const COPIED_ENTRIES: readonly string[] = [
  'planning/research-brief.md',
  'planning/research-plan.md',
  'planning/sources.md',
  'analysis/findings/codebase-cache.md',
  'analysis/synthesis.md',
  'outputs/research-report.md',
  'outputs/solution-exploration.md',
  'outputs/high-level-design.md',
  'outputs/decision-log.md',
  'stray-notes.txt',
];

const SOURCE_PRESERVED_ENTRIES: readonly string[] = ['outputs/solution-exploration.md', 'stray-notes.txt'];

beforeEach(() => {
  workspaceHarness.setup();
});

afterEach(() => {
  workspaceHarness.teardown();
});

test('copies the whole source directory verbatim and trims completed_phases at the fork point', () => {
  const workspace = workspaceHarness.workspace();
  const source = createSourceTask(workspace, makeSourceTaskState());
  const result = forkFromSource(workspace, {});

  expect(result.forkPoint).toBe('synthesis-complete');
  expect(result.forkName).toBe(`${new Date().toISOString().slice(0, ISO_DATE_LENGTH)}-fork-cache-alternative`);
  expect(result.forkPath).toBe(path.join(workspace.taskRoot, 'research', result.forkName));

  const forkPath = result.forkPath;
  for (const entry of COPIED_ENTRIES) {
    expect(fs.existsSync(path.join(forkPath, entry))).toBe(true);
  }

  // source untouched
  for (const entry of SOURCE_PRESERVED_ENTRIES) {
    expect(fs.existsSync(path.join(source, entry))).toBe(true);
  }

  const state = readForkState(forkPath);
  expect(state.orchestrator.completed_phases).toEqual(['brief-written', 'plan-created', 'findings-gathered', 'synthesis-complete']);
  expect(state.orchestrator.started_phase).toBeNull();
  expect(state.orchestrator.task_path).toBe(`.owflow/tasks/research/${result.forkName}`);
  expect(state.task.status).toBe('in_progress');
  expect(state.task.title).toContain('(fork of 2026-01-01-source-task)');
});

test('state beyond the fork point is carried verbatim — the resumed step overwrites it', () => {
  const workspace = workspaceHarness.workspace();
  createSourceTask(workspace, makeSourceTaskState());
  const result = forkFromSource(workspace, { from: 'plan-created' });

  const state = readForkState(result.forkPath);
  expect(state.orchestrator.completed_phases).toEqual(['brief-written', 'plan-created']);
  expect(state.research_context.phase_summaries.converge.decision_areas).toHaveLength(1);
  expect(state.research_outputs.synthesis).toBe('analysis/synthesis.md');
  expect(fs.existsSync(path.join(result.forkPath, 'analysis', 'synthesis.md'))).toBe(true);
});

test('fork at design-generated keeps the full chain minus research-completed', () => {
  const workspace = workspaceHarness.workspace();
  createSourceTask(workspace, makeSourceTaskState());
  const result = forkFromSource(workspace, { from: 'design-generated' });

  const state = readForkState(result.forkPath);
  expect(state.orchestrator.completed_phases).toEqual([
    'brief-written',
    'plan-created',
    'findings-gathered',
    'synthesis-complete',
    'alternatives-generated',
    'approaches-chosen',
    'design-generated',
  ]);
});

test('source without synthesis-complete still forks at a completed step', () => {
  const workspace = workspaceHarness.workspace();
  createSourceTask(
    workspace,
    makeSourceTaskState({
      completed: ['brief-written', 'plan-created', 'findings-gathered'],
      status: 'in_progress',
    }),
  );
  const result = forkFromSource(workspace, { from: 'findings-gathered' });

  expect(readForkState(result.forkPath).orchestrator.completed_phases).toEqual(['brief-written', 'plan-created', 'findings-gathered']);
});

test('identifier-only source resolves under .owflow/tasks/research/', () => {
  const workspace = workspaceHarness.workspace();
  createSourceTask(workspace, makeSourceTaskState());
  const result = forkFromSource(workspace, {});
  expect(fs.existsSync(result.forkPath)).toBe(true);
});

test('stamps fork_information with the intent, entry point and fork lineage', () => {
  const workspace = workspaceHarness.workspace();
  createSourceTask(workspace, makeSourceTaskState());
  const result = forkFromSource(workspace, { intent: 'compare caching strategies instead' });

  const state = readForkState(result.forkPath);
  expect(state.orchestrator.entry_point).toBe('research-fork');
  expect(state.orchestrator.options.fork_information).toEqual({
    forked_from: '2026-01-01-source-task',
    fork_point: 'synthesis-complete',
    forked_at: expect.any(String),
    intent: 'compare caching strategies instead',
  });
});

test('fork_information omits the intent when none is given and preserves existing options', () => {
  const workspace = workspaceHarness.workspace();
  const sourceState = makeSourceTaskState();
  sourceState.orchestrator.options = { spec_audit_enabled: false };
  createSourceTask(workspace, sourceState);
  const result = forkFromSource(workspace, {});

  const state = readForkState(result.forkPath);
  expect(state.orchestrator.options.spec_audit_enabled).toBe(false);
  expect(state.orchestrator.options.fork_information).toEqual({
    forked_from: '2026-01-01-source-task',
    fork_point: 'synthesis-complete',
    forked_at: expect.any(String),
  });
});

test('stamps fork_information when the source state has no options key', () => {
  const workspace = workspaceHarness.workspace();
  createSourceTask(workspace, makeSourceTaskState({ orchestrator: makeOrchestratorSection({ options: undefined }) }));
  const result = forkFromSource(workspace, { intent: 'narrow the scope to mobile' });

  const state = readForkState(result.forkPath);
  expect(state.orchestrator.options.fork_information.intent).toBe('narrow the scope to mobile');
});
