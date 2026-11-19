import { afterAll, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { scanHooks } from '../../hooks/hooks-registry.js';
import { DISPATCHABLE_EVENTS, EXCLUDED_EVENT_NAMES, HOOK_EVENT_NAMES, HOST_EVENT_NAMES, HookDigestMode } from '../../types/hook-types.js';
import { removeScratchDirectory } from '../fixtures/hooks/scratch-cleanup.js';

const EXPECTED_DISPATCHABLE_EVENTS = 16;
const EXPECTED_HOST_EVENTS = 32;
const EXPECTED_HOOK_EVENTS = 48;
const EXPECTED_INVALID_ENTRY_COUNT = 7;
const NULL_VALUE: null = JSON.parse('null');
const SCRATCH_ROOT = path.join(process.cwd(), '.test-scratch', 'hooks-registry');

const resolveBash = (command: string): string | null => (command === 'bash' ? '/bin/bash' : NULL_VALUE);

fs.rmSync(SCRATCH_ROOT, { recursive: true, force: true });
fs.mkdirSync(SCRATCH_ROOT, { recursive: true });

afterAll(() => {
  removeScratchDirectory(SCRATCH_ROOT);
});

test('event tables pin 16 lifecycle events, 32 host events, and 5 excluded names', () => {
  expect(DISPATCHABLE_EVENTS).toHaveLength(EXPECTED_DISPATCHABLE_EVENTS);
  expect(HOST_EVENT_NAMES).toHaveLength(EXPECTED_HOST_EVENTS);
  expect(HOOK_EVENT_NAMES).toHaveLength(EXPECTED_HOOK_EVENTS);
  expect(EXCLUDED_EVENT_NAMES).toEqual(['permission.ask', 'tool', 'auth', 'provider', 'experimental.provider.small_model']);
});

test('scanHooks validates directory existence and directory type', () => {
  const root = path.join(SCRATCH_ROOT, 'anchor-validation');
  fs.mkdirSync(root, { recursive: true });
  const missing = path.join(root, 'absent');
  expect(scanHooks(missing)).toEqual({ entries: [], failures: [] });

  const notDirectory = path.join(root, 'file-anchor');
  fs.writeFileSync(notDirectory, 'x');
  expect(() => scanHooks(notDirectory)).toThrow(/1 invalid entry.*the hooks anchor exists but is not a directory/s);
  expect(scanHooks(notDirectory, { mode: HookDigestMode.Report }).failures).toHaveLength(1);
});

test('scanHooks discovers valid hook scripts and resolves interpreters', () => {
  const root = path.join(SCRATCH_ROOT, 'discovery');
  const hooksDirectory = path.join(root, '.owflow', 'hooks');
  fs.mkdirSync(hooksDirectory, { recursive: true });
  fs.writeFileSync(path.join(hooksDirectory, 'tool-execute-before.sh'), '');
  fs.writeFileSync(path.join(hooksDirectory, 'session-idle.ps1'), '');

  const valid = scanHooks(hooksDirectory, { which: resolveBash });
  expect(valid.failures).toEqual([]);
  expect(valid.entries).toEqual([
    {
      path: path.join(hooksDirectory, 'session-idle.ps1'),
      event: 'session.idle',
      interpreter: { expected: 'pwsh', available: false },
      status: 'will-fail-closed',
    },
    {
      path: path.join(hooksDirectory, 'tool-execute-before.sh'),
      event: 'tool.execute.before',
      interpreter: { expected: 'bash', available: true, resolved: '/bin/bash' },
      status: 'registered',
    },
  ]);
});

test('scanHooks correctly maps hyphenated host events like installation.update-available', () => {
  const root = path.join(SCRATCH_ROOT, 'hyphenated');
  const hooksDirectory = path.join(root, '.owflow', 'hooks');
  fs.mkdirSync(hooksDirectory, { recursive: true });
  fs.writeFileSync(path.join(hooksDirectory, 'installation-update-available.sh'), '');

  const valid = scanHooks(hooksDirectory, { which: resolveBash });
  expect(valid.failures).toEqual([]);
  expect(valid.entries).toEqual([
    {
      path: path.join(hooksDirectory, 'installation-update-available.sh'),
      event: 'installation.update-available',
      interpreter: { expected: 'bash', available: true, resolved: '/bin/bash' },
      status: 'registered',
    },
  ]);
});

test('scanHooks flags invalid files, extensions, stems, excluded/unknown events, and duplicates', () => {
  const root = path.join(SCRATCH_ROOT, 'invalid-entries');
  const hooksDirectory = path.join(root, '.owflow', 'hooks');
  fs.mkdirSync(hooksDirectory, { recursive: true });
  fs.writeFileSync(path.join(hooksDirectory, 'session-idle.ps1'), '');

  fs.mkdirSync(path.join(hooksDirectory, 'subdir'));
  fs.writeFileSync(path.join(hooksDirectory, 'invalid.txt'), '');
  fs.writeFileSync(path.join(hooksDirectory, 'Bad_Name.sh'), '');
  fs.writeFileSync(path.join(hooksDirectory, 'permission-ask.sh'), '');
  fs.writeFileSync(path.join(hooksDirectory, 'unknown-event.sh'), '');
  fs.writeFileSync(path.join(hooksDirectory, 'tool-execute-before.sh'), '');
  fs.writeFileSync(path.join(hooksDirectory, 'tool-execute-before.ps1'), '');

  expect(() => scanHooks(hooksDirectory)).toThrow(/7 invalid entries/);
  expect(() => scanHooks(hooksDirectory)).toThrow(
    /User hooks are bypassed until the hooks directory validates; the built-in destructive-command guard remains active/,
  );
  const report = scanHooks(hooksDirectory, { mode: HookDigestMode.Report });
  expect(report.entries.map((entry) => entry.event)).toEqual(['session.idle']);
  expect(report.failures).toHaveLength(EXPECTED_INVALID_ENTRY_COUNT);
});

test('scanHooks silently ignores OS and editor noise (.DS_Store, README.md, thumbs.db, editor swap files)', () => {
  const root = path.join(SCRATCH_ROOT, 'os-noise');
  const hooksDirectory = path.join(root, '.owflow', 'hooks');
  fs.mkdirSync(hooksDirectory, { recursive: true });
  fs.writeFileSync(path.join(hooksDirectory, 'tool-execute-before.sh'), '');
  fs.writeFileSync(path.join(hooksDirectory, '.DS_Store'), '');
  fs.writeFileSync(path.join(hooksDirectory, 'README.md'), '');
  fs.writeFileSync(path.join(hooksDirectory, 'Thumbs.db'), '');
  fs.writeFileSync(path.join(hooksDirectory, 'desktop.ini'), '');
  fs.writeFileSync(path.join(hooksDirectory, '.gitkeep'), '');
  fs.writeFileSync(path.join(hooksDirectory, 'tool.sh~'), '');
  fs.writeFileSync(path.join(hooksDirectory, '.tool.sh.swp'), '');

  const scan = scanHooks(hooksDirectory, { which: resolveBash });
  expect(scan.failures).toEqual([]);
  expect(scan.entries).toHaveLength(1);
  expect(scan.entries[0]!.event).toBe('tool.execute.before');
});
