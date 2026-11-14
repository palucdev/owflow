import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  cleanupForkWorkspaces,
  createBaseStateWith,
  createBaseStateWithOptions,
  createBaseStateWithoutOptions,
  createForkWorkspace,
  createSourceTask,
  forkInWorkspace,
  prefixDate,
  readForkState,
} from './fork-task-test-helpers.js';

const FORK_SLUG = 'fork-cache-alternative';
const COPIED_ARTIFACTS = [
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

const expectCopiedArtifacts = (forkPath: string): void => {
  for (const relativePath of COPIED_ARTIFACTS) {
    expect(fs.existsSync(path.join(forkPath, relativePath))).toBe(true);
  }
};

const expectForkState = (forkPath: string, expectedPhases: readonly string[]): void => {
  const state = readForkState(forkPath);
  expect(state.orchestrator.completed_phases).toEqual(expectedPhases);
  expect(state.orchestrator.started_phase).toBeNull();
  expect(state.orchestrator.task_path).toBe(`.owflow/tasks/research/${path.basename(forkPath)}`);
  expect(state.task.status).toBe('in_progress');
  expect(state.task.title).toContain('(fork of 2026-01-01-source-task)');
};

afterEach(cleanupForkWorkspaces);

describe('forkTask execution', () => {
  test('copies the whole source directory verbatim and trims completed_phases at the fork point', () => {
    const workspace = createForkWorkspace();
    const source = createSourceTask(workspace);
    const result = forkInWorkspace(workspace);

    expect(result.forkPoint).toBe('synthesis-complete');
    expect(result.forkName).toBe(prefixDate(FORK_SLUG));
    expect(result.forkPath).toBe(path.join(workspace.taskRoot, 'research', result.forkName));

    expectCopiedArtifacts(result.forkPath);
    expect(fs.existsSync(path.join(source, 'outputs', 'solution-exploration.md'))).toBe(true);
    expect(fs.existsSync(path.join(source, 'stray-notes.txt'))).toBe(true);
    expectForkState(result.forkPath, ['brief-written', 'plan-created', 'findings-gathered', 'synthesis-complete']);
  });
});

describe('forkTask state preservation', () => {
  test('state beyond the fork point is carried verbatim — the resumed step overwrites it', () => {
    const workspace = createForkWorkspace();
    createSourceTask(workspace);
    const result = forkInWorkspace(workspace, { from: 'plan-created' });

    const state = readForkState(result.forkPath);
    expect(state.orchestrator.completed_phases).toEqual(['brief-written', 'plan-created']);
    expect(state.research_context.phase_summaries.converge.decision_areas).toHaveLength(1);
    expect(state.research_outputs.synthesis).toBe('analysis/synthesis.md');
    expect(fs.existsSync(path.join(result.forkPath, 'analysis', 'synthesis.md'))).toBe(true);
  });

  test('fork at design-generated keeps the full chain minus research-completed', () => {
    const workspace = createForkWorkspace();
    createSourceTask(workspace);
    const result = forkInWorkspace(workspace, { from: 'design-generated' });

    expect(readForkState(result.forkPath).orchestrator.completed_phases).toEqual([
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
    const workspace = createForkWorkspace();
    createSourceTask(
      workspace,
      createBaseStateWith({
        completed: ['brief-written', 'plan-created', 'findings-gathered'],
        status: 'in_progress',
      }),
    );
    const result = forkInWorkspace(workspace, { from: 'findings-gathered' });

    expect(readForkState(result.forkPath).orchestrator.completed_phases).toEqual(['brief-written', 'plan-created', 'findings-gathered']);
  });

  test('identifier-only source resolves under .owflow/tasks/research/', () => {
    const workspace = createForkWorkspace();
    createSourceTask(workspace);
    const result = forkInWorkspace(workspace);
    expect(fs.existsSync(result.forkPath)).toBe(true);
  });
});

describe('forkTask lineage metadata', () => {
  test('stamps fork_information with the intent, entry point and fork lineage', () => {
    const workspace = createForkWorkspace();
    createSourceTask(workspace);
    const result = forkInWorkspace(workspace, { intent: 'compare caching strategies instead' });

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
    const workspace = createForkWorkspace();
    createSourceTask(workspace, createBaseStateWithOptions({ spec_audit_enabled: false }));
    const result = forkInWorkspace(workspace);

    const state = readForkState(result.forkPath);
    expect(state.orchestrator.options.spec_audit_enabled).toBe(false);
    expect(state.orchestrator.options.fork_information).toEqual({
      forked_from: '2026-01-01-source-task',
      fork_point: 'synthesis-complete',
      forked_at: expect.any(String),
    });
  });

  test('stamps fork_information when the source state has no options key', () => {
    const workspace = createForkWorkspace();
    createSourceTask(workspace, createBaseStateWithoutOptions());
    const result = forkInWorkspace(workspace, { intent: 'narrow the scope to mobile' });

    const state = readForkState(result.forkPath);
    expect(state.orchestrator.options.fork_information.intent).toBe('narrow the scope to mobile');
  });
});
