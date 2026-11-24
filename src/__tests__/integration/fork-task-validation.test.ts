import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

import { RESEARCH_SLUG_PATTERN } from '../../utils/fork-task.js';
import { createForkWorkspaceHarness, createSourceTask, forkFromSource, makeSourceTaskState, writeState } from '../utils/fork-task-fixtures.js';

const workspaceHarness = createForkWorkspaceHarness();

beforeEach(() => {
  workspaceHarness.setup();
});

afterEach(() => {
  workspaceHarness.teardown();
});

describe('forkTask (fork point validation)', () => {
  test('UNKNOWN_STEP: invalid slug, terminal step, and non-completed slug all blocked', () => {
    const workspace = workspaceHarness.workspace();
    createSourceTask(workspace, makeSourceTaskState());

    expect(() => forkFromSource(workspace, { from: 'bogus-slug' })).toThrow(/UNKNOWN_STEP/);
    expect(() => forkFromSource(workspace, { from: 'research-completed' })).toThrow(/UNKNOWN_STEP/);

    // not completed in the source
    writeState(
      path.join(workspace.taskRoot, 'research', '2026-01-01-source-task'),
      makeSourceTaskState({ completed: ['brief-written', 'plan-created', 'findings-gathered', 'synthesis-complete'] }),
    );
    expect(() => forkFromSource(workspace, { from: 'alternatives-generated' })).toThrow(/UNKNOWN_STEP/);
  });
});

describe('forkTask (name and source validation)', () => {
  test('NAME_TAKEN and INVALID_NAME rejected; fork not created', () => {
    const workspace = workspaceHarness.workspace();
    createSourceTask(workspace, makeSourceTaskState());
    forkFromSource(workspace, {});

    expect(() => forkFromSource(workspace, {})).toThrow(/NAME_TAKEN/);
    expect(() => forkFromSource(workspace, { slug: 'Too-Caps' })).toThrow(/INVALID_NAME/);
    expect(() => forkFromSource(workspace, { slug: 'short' })).toThrow(/INVALID_NAME/);
    expect(() => forkFromSource(workspace, { slug: 'way-too-many-words-for-a-slug-here' })).toThrow(/INVALID_NAME/);
  });

  test('INVALID_SOURCE: missing dir, non-research dir, missing state', () => {
    const workspace = workspaceHarness.workspace();
    createSourceTask(workspace, makeSourceTaskState());

    expect(() => forkFromSource(workspace, { source: '2026-01-01-does-not-exist' })).toThrow(/INVALID_SOURCE/);

    // non-research location
    const developmentTask = path.join(workspace.taskRoot, 'development', '2026-01-01-dev-task');
    fs.mkdirSync(developmentTask, { recursive: true });
    writeState(developmentTask, makeSourceTaskState());
    expect(() => forkFromSource(workspace, { source: developmentTask })).toThrow(/INVALID_SOURCE/);

    // directory without a state file
    const emptyTask = path.join(workspace.taskRoot, 'research', '2026-01-01-empty-task');
    fs.mkdirSync(emptyTask, { recursive: true });
    expect(() => forkFromSource(workspace, { source: '2026-01-01-empty-task' })).toThrow(/INVALID_SOURCE/);
  });
});

describe('slug pattern', () => {
  test('matches Task Name Generation shape', () => {
    expect(RESEARCH_SLUG_PATTERN.test('compare-caching-strategies')).toBe(true);
    expect(RESEARCH_SLUG_PATTERN.test('fork-cache-alternative')).toBe(true);
    expect(RESEARCH_SLUG_PATTERN.test('Too-Caps')).toBe(false);
    expect(RESEARCH_SLUG_PATTERN.test('short')).toBe(false);
    expect(RESEARCH_SLUG_PATTERN.test('a-b-c-d-e-f')).toBe(false);
  });
});
