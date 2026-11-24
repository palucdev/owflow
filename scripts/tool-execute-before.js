#!/usr/bin/env bun
// Pre-execution guard hook for OpenCode tools (tool.execute.before): protects
// eslint.config.mjs from being modified, truncated, or deleted by autonomous
// tools. Reads the tool invocation payload from argv[2] or stdin and prints
// { "decision": "approve" } with exit code 0, or { "decision": "block",
// "reason": "..." } with exit code 1.

import fs from 'node:fs';
import path from 'node:path';

const FORBIDDEN_FILE_NAME = 'eslint.config.mjs';

const FORBIDDEN_REASON =
  'Modifying eslint.config.mjs is forbidden.\n\n' +
  'If you believe a rule makes your task impossible,\n' +
  'report this to the user and explain why.';

// Any of these shell tokens combined with a mention of the config file marks
// the command as a modification attempt, in any order of appearance.
const MODIFYING_COMMAND_TOKENS = ['rm', 'mv', 'cp', 'truncate', 'sed -i', 'tee', '>', '|'];

const approve = () => {
  console.log(JSON.stringify({ decision: 'approve' }));
  process.exit(0);
};

const block = () => {
  console.log(JSON.stringify({ decision: 'block', reason: FORBIDDEN_REASON }));
  process.exit(1);
};

const readRawInput = () => {
  if (process.argv[2] && process.argv[2].trim().length > 0) {
    return process.argv[2];
  }
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
};

const parsePayload = (raw) => {
  if (!raw || raw.trim().length === 0) {
    return;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return;
  }
};

const isReadTool = (data) => data.tool === 'read' || data.context?.tool === 'read';

const resolveToolArguments = (data) => data.args || data.context?.args || data.tool_input || data.context?.tool_input || data;

const resolveCommand = (data, toolArguments) => toolArguments.command || data.context?.command || '';

const isForbiddenCommand = (command) => {
  const normalizedCommand = String(command).toLowerCase();
  return (
    normalizedCommand.includes(FORBIDDEN_FILE_NAME) && MODIFYING_COMMAND_TOKENS.some((token) => normalizedCommand.includes(token))
  );
};

const isForbiddenTargetFile = (data, toolArguments) => {
  const targetFile = [
    toolArguments.filePath,
    toolArguments.file_path,
    toolArguments.file,
    toolArguments.path,
    data.filePath,
    data.file_path,
    data.file,
    data.path,
  ].find((candidate) => typeof candidate === 'string');
  return targetFile !== undefined && path.basename(targetFile) === FORBIDDEN_FILE_NAME;
};

const main = () => {
  const data = parsePayload(readRawInput());
  if (!data || isReadTool(data)) {
    approve();
  }
  const toolArguments = resolveToolArguments(data);
  if (isForbiddenCommand(resolveCommand(data, toolArguments)) || isForbiddenTargetFile(data, toolArguments)) {
    block();
  }
  approve();
};

main();
