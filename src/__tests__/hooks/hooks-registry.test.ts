import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanHooks } from '../../hooks/hooks-registry.js';
import { DISPATCHABLE_EVENTS, EXCLUDED_EVENT_NAMES, HOOK_EVENT_NAMES, HOST_EVENT_NAMES, HookDigestMode } from '../../types/hook-types.js';

const EXPECTED_DISPATCHABLE_EVENT_COUNT = 16;
const EXPECTED_HOST_EVENT_COUNT = 32;
const EXPECTED_HOOK_EVENT_COUNT = 48;
const EXPECTED_INVALID_ENTRY_COUNT = 7;

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'owflow-discovery-unit-'));
  temporaryDirectories.push(directory);
  return directory;
};

const createHooksDirectory = (temporaryDirectory: string): string => {
  const hooksDirectory = path.join(temporaryDirectory, '.owflow', 'hooks');
  fs.mkdirSync(hooksDirectory, { recursive: true });
  return hooksDirectory;
};

const writeHookFile = (hooksDirectory: string, fileName: string): void => {
  fs.writeFileSync(path.join(hooksDirectory, fileName), '');
};

const whichBashOnly = (command: string): string | undefined => (command === 'bash' ? '/bin/bash' : undefined);

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('hook event tables', () => {
  test('event tables pin 16 lifecycle events, 32 host events, and 5 excluded names', () => {
    expect(DISPATCHABLE_EVENTS).toHaveLength(EXPECTED_DISPATCHABLE_EVENT_COUNT);
    expect(HOST_EVENT_NAMES).toHaveLength(EXPECTED_HOST_EVENT_COUNT);
    expect(HOOK_EVENT_NAMES).toHaveLength(EXPECTED_HOOK_EVENT_COUNT);
    expect(EXCLUDED_EVENT_NAMES).toEqual(['permission.ask', 'tool', 'auth', 'provider', 'experimental.provider.small_model']);
  });
});

describe('scanHooks directory validation', () => {
  test('scanHooks validates directory existence and directory type', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const missingDirectory = path.join(temporaryDirectory, 'absent');
    expect(scanHooks(missingDirectory)).toEqual({ entries: [], failures: [] });

    const notDirectory = path.join(temporaryDirectory, 'file-anchor');
    fs.writeFileSync(notDirectory, 'x');
    expect(() => scanHooks(notDirectory)).toThrow(/1 invalid entry.*the hooks anchor exists but is not a directory/s);
    expect(scanHooks(notDirectory, { mode: HookDigestMode.Report }).failures).toHaveLength(1);
  });
});

describe('scanHooks interpreter resolution', () => {
  test('scanHooks discovers valid hook scripts and resolves interpreters', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const hooksDirectory = createHooksDirectory(temporaryDirectory);
    writeHookFile(hooksDirectory, 'tool-execute-before.sh');
    writeHookFile(hooksDirectory, 'session-idle.ps1');

    const valid = scanHooks(hooksDirectory, { which: whichBashOnly });
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
    const temporaryDirectory = createTemporaryDirectory();
    const hooksDirectory = createHooksDirectory(temporaryDirectory);
    writeHookFile(hooksDirectory, 'installation-update-available.sh');

    const valid = scanHooks(hooksDirectory, { which: whichBashOnly });
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
});

describe('scanHooks validation failures', () => {
  test('scanHooks flags invalid files, extensions, stems, excluded/unknown events, and duplicates', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const hooksDirectory = createHooksDirectory(temporaryDirectory);
    writeHookFile(hooksDirectory, 'session-idle.ps1');

    fs.mkdirSync(path.join(hooksDirectory, 'subdir'));
    writeHookFile(hooksDirectory, 'invalid.txt');
    writeHookFile(hooksDirectory, 'Bad_Name.sh');
    writeHookFile(hooksDirectory, 'permission-ask.sh');
    writeHookFile(hooksDirectory, 'unknown-event.sh');
    writeHookFile(hooksDirectory, 'tool-execute-before.sh');
    writeHookFile(hooksDirectory, 'tool-execute-before.ps1');

    expect(() => scanHooks(hooksDirectory)).toThrow(/7 invalid entries/);
    expect(() => scanHooks(hooksDirectory)).toThrow(
      /User hooks are bypassed until the hooks directory validates; the built-in destructive-command guard remains active/,
    );
    const report = scanHooks(hooksDirectory, { mode: HookDigestMode.Report });
    expect(report.entries.map((entry) => entry.event)).toEqual(['session.idle']);
    expect(report.failures).toHaveLength(EXPECTED_INVALID_ENTRY_COUNT);
  });
});

describe('scanHooks noise filtering', () => {
  test('scanHooks silently ignores OS and editor noise (.DS_Store, README.md, thumbs.db, editor swap files)', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const hooksDirectory = createHooksDirectory(temporaryDirectory);
    writeHookFile(hooksDirectory, 'tool-execute-before.sh');
    writeHookFile(hooksDirectory, '.DS_Store');
    writeHookFile(hooksDirectory, 'README.md');
    writeHookFile(hooksDirectory, 'Thumbs.db');
    writeHookFile(hooksDirectory, 'desktop.ini');
    writeHookFile(hooksDirectory, '.gitkeep');
    writeHookFile(hooksDirectory, 'tool.sh~');
    writeHookFile(hooksDirectory, '.tool.sh.swp');

    const scan = scanHooks(hooksDirectory, { which: whichBashOnly });
    expect(scan.failures).toEqual([]);
    expect(scan.entries).toHaveLength(1);
    expect(scan.entries[0]!.event).toBe('tool.execute.before');
  });
});
