import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'yaml';

import { findStructuralErrors, parseYamlFile } from '../../utils/yaml-structure.js';

describe('parseYamlFile', () => {
  let temporaryDirectory: string;

  const writeYamlFile = (fileName: string, content: string): string => {
    const filePath = path.join(temporaryDirectory, fileName);
    fs.writeFileSync(filePath, content, 'utf8');
    return filePath;
  };

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'owflow-yaml-structure-test-'));
  });

  afterEach(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  test('parses a valid YAML file into data', () => {
    const filePath = writeYamlFile('valid.yml', yaml.stringify({ orchestrator: { task_path: 'research/source-task' } }));
    const parsed = parseYamlFile(filePath);

    expect(parsed.isOk).toBe(true);
    expect(parsed.data).toEqual({ orchestrator: { task_path: 'research/source-task' } });
  });

  test('reports the file path when the file is missing', () => {
    const parsed = parseYamlFile(path.join(temporaryDirectory, 'missing.yml'));

    expect(parsed.isOk).toBe(false);
    expect(parsed.error).toContain('missing.yml');
  });

  test('reports a non-empty parse error for invalid YAML', () => {
    const filePath = writeYamlFile('invalid.yml', 'orchestrator: [unclosed-flow-sequence');
    const parsed = parseYamlFile(filePath);

    expect(parsed.isOk).toBe(false);
    expect(parsed.error).toBeTruthy();
  });
});

describe('findStructuralErrors', () => {
  test('returns no errors when the target covers the template shape', () => {
    const template = { orchestrator: { options: { intent: 'string' } }, task: { status: 'string' } };
    const target = { orchestrator: { options: { intent: 'compare caching', extra: 'ignored' } }, task: { status: 'in_progress' } };

    expect(findStructuralErrors(template, target)).toEqual([]);
  });

  test('reports a missing top-level key', () => {
    const template = { orchestrator: {}, task: {} };
    const target = { orchestrator: {} };

    expect(findStructuralErrors(template, target)).toEqual(['Missing key: task']);
  });

  test('renders a missing nested key as a dotted path', () => {
    const template = { outer: { inner: 'string' } };
    const target = { outer: {} };

    expect(findStructuralErrors(template, target)).toEqual(['Missing key: outer.inner']);
  });

  test('returns no errors when the template is not a record', () => {
    expect(findStructuralErrors('template-string', { orchestrator: {} })).toEqual([]);
  });

  test('reports every template key missing when the target is not a record', () => {
    const template = { orchestrator: {}, task: {} };

    expect(findStructuralErrors(template, 'target-string')).toEqual(['Missing key: orchestrator', 'Missing key: task']);
  });
});
