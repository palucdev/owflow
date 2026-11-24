import path from 'node:path';

/**
Canonical owflow directory names. Host projects and every internal surface
(server plugin, CLI, TUI, hooks, tools) refer to these constants instead of
repeating path fragments.
*/
const WORKFLOW_DIRECTORY_NAME = '.owflow';
const HOOKS_DIRECTORY_NAME = 'hooks';
export const TASKS_DIRECTORY_NAME = 'tasks';
export const RESEARCH_DIRECTORY_NAME = 'research';

const workflowPath = (root: string, ...segments: readonly string[]): string => path.join(root, WORKFLOW_DIRECTORY_NAME, ...segments);

export const workflowRelativePath = (...segments: readonly string[]): string => [WORKFLOW_DIRECTORY_NAME, ...segments].join('/');

export const hooksDirectory = (root: string): string => workflowPath(root, HOOKS_DIRECTORY_NAME);

export const tasksDirectory = (root: string): string => workflowPath(root, TASKS_DIRECTORY_NAME);

export const hooksLocationLabel = workflowRelativePath(HOOKS_DIRECTORY_NAME);
