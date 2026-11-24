import { expect, test } from 'bun:test';
import path from 'node:path';

import {
  hooksDirectory,
  hooksLocationLabel,
  RESEARCH_DIRECTORY_NAME,
  TASKS_DIRECTORY_NAME,
  tasksDirectory,
  workflowRelativePath,
} from '../../utils/workflow-paths.js';

const WORKSPACE_ROOT = '/workspace/project-root';

test('hooksDirectory and tasksDirectory join under the .owflow workflow directory', () => {
  expect(hooksDirectory(WORKSPACE_ROOT)).toBe(path.join(WORKSPACE_ROOT, '.owflow', 'hooks'));
  expect(tasksDirectory(WORKSPACE_ROOT)).toBe(path.join(WORKSPACE_ROOT, '.owflow', 'tasks'));
});

test('workflowRelativePath joins single and multiple segments with forward slashes', () => {
  expect(workflowRelativePath()).toBe('.owflow');
  expect(workflowRelativePath('tasks')).toBe('.owflow/tasks');
  expect(workflowRelativePath('tasks', 'research')).toBe('.owflow/tasks/research');
});

test('hooksLocationLabel points at the .owflow/hooks directory', () => {
  expect(hooksLocationLabel).toBe('.owflow/hooks');
});

test('TASKS_DIRECTORY_NAME and RESEARCH_DIRECTORY_NAME hold their canonical names', () => {
  expect(TASKS_DIRECTORY_NAME).toBe('tasks');
  expect(RESEARCH_DIRECTORY_NAME).toBe('research');
});
