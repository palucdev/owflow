import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { PLUGIN_VERSION, readPluginVersion } from '../../utils/plugin-info.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.join(__dirname, '../../..');

const workspace = { directory: '' };

// Mirrors the real layout: package.json sits one level above the plugin root.
const makePluginRoot = (packageJson: string | undefined): string => {
  const root = path.join(workspace.directory, 'dist');
  fs.mkdirSync(root, { recursive: true });
  if (packageJson !== undefined) {
    fs.writeFileSync(path.join(workspace.directory, 'package.json'), packageJson, 'utf8');
  }
  return root;
};

beforeEach(() => {
  workspace.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'owflow-plugin-info-test-'));
});

afterEach(() => {
  if (fs.existsSync(workspace.directory)) {
    fs.rmSync(workspace.directory, { recursive: true, force: true });
  }
});

describe('PLUGIN_VERSION', () => {
  test('should match the version in the repository package.json', () => {
    const packageManifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8')) as { version: string };

    expect(PLUGIN_VERSION).toBe(packageManifest.version);
  });

  test('should resolve from the default plugin root', () => {
    expect(readPluginVersion()).toBe(PLUGIN_VERSION);
  });
});

describe('readPluginVersion', () => {
  test('should read the version from package.json above the plugin root', () => {
    const root = makePluginRoot(JSON.stringify({ version: '1.2.3' }));
    expect(readPluginVersion(root)).toBe('1.2.3');
  });

  test("should return 'unknown' when package.json is missing", () => {
    const root = makePluginRoot(undefined);
    expect(readPluginVersion(root)).toBe('unknown');
  });

  test("should return 'unknown' when package.json is not valid JSON", () => {
    const root = makePluginRoot('not-json{');
    expect(readPluginVersion(root)).toBe('unknown');
  });

  test("should return 'unknown' when the version field is absent", () => {
    const root = makePluginRoot(JSON.stringify({ name: 'owflow' }));
    expect(readPluginVersion(root)).toBe('unknown');
  });

  test("should return 'unknown' when the version field is not a non-empty string", () => {
    const numericVersionRoot = makePluginRoot(JSON.stringify({ version: 123 }));
    const emptyVersionRoot = makePluginRoot(JSON.stringify({ version: '' }));
    expect(readPluginVersion(numericVersionRoot)).toBe('unknown');
    expect(readPluginVersion(emptyVersionRoot)).toBe('unknown');
  });
});
