import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { RESEARCH_SLUG_PATTERN } from '../../utils/fork-task.js';
import {
  cleanupForkWorkspaces,
  createBaseStateWith,
  createForkWorkspace,
  createSourceTask,
  forkInWorkspace,
  writeState,
} from './fork-task-test-helpers.js';

const INVALID_CAPS_SLUG = 'Too-Caps';
const INVALID_SHORT_SLUG = 'short';
const INVALID_LONG_SLUG = 'way-too-many-words-for-a-slug-here';
const DEVELOPMENT_TASK_NAME = '2026-01-01-dev-task';
const EMPTY_TASK_NAME = '2026-01-01-empty-task';

afterEach(cleanupForkWorkspaces);

describe('forkTask step validation', () => {
  test('UNKNOWN_STEP: invalid slug, terminal step, and non-completed slug all blocked', () => {
    const workspace = createForkWorkspace();
    createSourceTask(workspace);

    expect(() => forkInWorkspace(workspace, { from: 'bogus-slug' })).toThrow(/UNKNOWN_STEP/);
    expect(() => forkInWorkspace(workspace, { from: 'research-completed' })).toThrow(/UNKNOWN_STEP/);

    const sourceDirectory = path.join(workspace.taskRoot, 'research', '2026-01-01-source-task');
    writeState(
      sourceDirectory,
      createBaseStateWith({
        completed: ['brief-written', 'plan-created', 'findings-gathered', 'synthesis-complete'],
      }),
    );
    expect(() => forkInWorkspace(workspace, { from: 'alternatives-generated' })).toThrow(/UNKNOWN_STEP/);
  });
});

describe('forkTask name validation', () => {
  test('NAME_TAKEN and INVALID_NAME rejected; fork not created', () => {
    const workspace = createForkWorkspace();
    createSourceTask(workspace);
    forkInWorkspace(workspace);

    expect(() => forkInWorkspace(workspace)).toThrow(/NAME_TAKEN/);
    expect(() => forkInWorkspace(workspace, { slug: INVALID_CAPS_SLUG })).toThrow(/INVALID_NAME/);
    expect(() => forkInWorkspace(workspace, { slug: INVALID_SHORT_SLUG })).toThrow(/INVALID_NAME/);
    expect(() => forkInWorkspace(workspace, { slug: INVALID_LONG_SLUG })).toThrow(/INVALID_NAME/);
  });
});

describe('forkTask source validation', () => {
  test('INVALID_SOURCE: missing dir, non-research dir, missing state', () => {
    const workspace = createForkWorkspace();
    createSourceTask(workspace);

    expect(() => forkInWorkspace(workspace, { source: '2026-01-01-does-not-exist' })).toThrow(/INVALID_SOURCE/);

    const developmentTask = path.join(workspace.taskRoot, 'development', DEVELOPMENT_TASK_NAME);
    fs.mkdirSync(developmentTask, { recursive: true });
    writeState(developmentTask, createBaseStateWith({}));
    expect(() => forkInWorkspace(workspace, { source: developmentTask })).toThrow(/INVALID_SOURCE/);

    const emptyTask = path.join(workspace.taskRoot, 'research', EMPTY_TASK_NAME);
    fs.mkdirSync(emptyTask, { recursive: true });
    expect(() => forkInWorkspace(workspace, { source: EMPTY_TASK_NAME })).toThrow(/INVALID_SOURCE/);
  });
});

describe('research slug pattern', () => {
  test('matches Task Name Generation shape', () => {
    expect(RESEARCH_SLUG_PATTERN.test('compare-caching-strategies')).toBe(true);
    expect(RESEARCH_SLUG_PATTERN.test('fork-cache-alternative')).toBe(true);
    expect(RESEARCH_SLUG_PATTERN.test(INVALID_CAPS_SLUG)).toBe(false);
    expect(RESEARCH_SLUG_PATTERN.test(INVALID_SHORT_SLUG)).toBe(false);
    expect(RESEARCH_SLUG_PATTERN.test('a-b-c-d-e-f')).toBe(false);
  });
});
