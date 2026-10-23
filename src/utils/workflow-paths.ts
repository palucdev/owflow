import path from "node:path";

/**
 * Canonical owflow directory names. Host projects and every internal surface
 * (server plugin, CLI, TUI, hooks, tools) refer to these constants instead of
 * repeating path fragments.
 */
export const WORKFLOW_DIRECTORY_NAME = ".owflow";
export const HOOKS_DIRECTORY_NAME = "hooks";
export const TASKS_DIRECTORY_NAME = "tasks";
export const DOCS_DIRECTORY_NAME = "docs";
export const RESEARCH_DIRECTORY_NAME = "research";

export const workflowPath = (
  root: string,
  ...segments: readonly string[]
): string => path.join(root, WORKFLOW_DIRECTORY_NAME, ...segments);

export const workflowRelativePath = (
  ...segments: readonly string[]
): string => [WORKFLOW_DIRECTORY_NAME, ...segments].join("/");

export const hooksDirectory = (root: string): string =>
  workflowPath(root, HOOKS_DIRECTORY_NAME);

export const tasksDirectory = (root: string): string =>
  workflowPath(root, TASKS_DIRECTORY_NAME);

export const docsDirectory = (root: string): string =>
  workflowPath(root, DOCS_DIRECTORY_NAME);

export const hooksLocationLabel = workflowRelativePath(HOOKS_DIRECTORY_NAME);
export const tasksLocationLabel = workflowRelativePath(TASKS_DIRECTORY_NAME);
