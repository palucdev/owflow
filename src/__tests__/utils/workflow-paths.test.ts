import { expect, test } from 'bun:test';

import {
  hooksLocationLabel,
  RESEARCH_DIRECTORY_NAME,
  TASKS_DIRECTORY_NAME,
  workflowRelativePath,
} from '../../utils/workflow-paths.js';

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
