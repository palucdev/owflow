import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanHooks } from '../../hooks/hooks-discovery.js';
import { DISPATCHABLE_EVENTS, EXCLUDED_EVENT_NAMES, HOOK_EVENT_NAMES, HOST_EVENT_NAMES, HookDigestMode } from '../../types/hook-types.js';

describe('hooks-discovery (scanHooks and validation)', () => {
  const tempDirs: string[] = [];

  const makeTempDir = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owflow-discovery-unit-'));
    tempDirs.push(dir);
    return dir;
  };

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('event tables pin 16 lifecycle events, 32 host events, and 5 excluded names', () => {
    expect(DISPATCHABLE_EVENTS).toHaveLength(16);
    expect(HOST_EVENT_NAMES).toHaveLength(32);
    expect(HOOK_EVENT_NAMES).toHaveLength(48);
    expect(EXCLUDED_EVENT_NAMES).toEqual(['permission.ask', 'tool', 'auth', 'provider', 'experimental.provider.small_model']);
  });

  test('scanHooks validates directory existence and directory type', () => {
    const root = makeTempDir();
    const missing = path.join(root, 'absent');
    expect(scanHooks(missing)).toEqual({ entries: [], failures: [] });

    const notDir = path.join(root, 'file-anchor');
    fs.writeFileSync(notDir, 'x');
    expect(() => scanHooks(notDir)).toThrow(/1 invalid entry.*the hooks anchor exists but is not a directory/s);
    expect(scanHooks(notDir, { mode: HookDigestMode.Report }).failures).toHaveLength(1);
  });

  test('scanHooks discovers valid hook scripts and resolves interpreters', () => {
    const root = makeTempDir();
    const hooksDir = path.join(root, '.owflow', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'tool-execute-before.sh'), '');
    fs.writeFileSync(path.join(hooksDir, 'session-idle.ps1'), '');

    const valid = scanHooks(hooksDir, {
      which: (cmd) => (cmd === 'bash' ? '/bin/bash' : null),
    });
    expect(valid.failures).toEqual([]);
    expect(valid.entries).toEqual([
      {
        path: path.join(hooksDir, 'session-idle.ps1'),
        event: 'session.idle',
        interpreter: { expected: 'pwsh', available: false },
        status: 'will-fail-closed',
      },
      {
        path: path.join(hooksDir, 'tool-execute-before.sh'),
        event: 'tool.execute.before',
        interpreter: { expected: 'bash', available: true, resolved: '/bin/bash' },
        status: 'registered',
      },
    ]);
  });

  test('scanHooks flags invalid files, extensions, stems, excluded/unknown events, and duplicates', () => {
    const root = makeTempDir();
    const hooksDir = path.join(root, '.owflow', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'session-idle.ps1'), '');

    fs.mkdirSync(path.join(hooksDir, 'subdir'));
    fs.writeFileSync(path.join(hooksDir, 'readme.md'), '');
    fs.writeFileSync(path.join(hooksDir, 'Bad_Name.sh'), '');
    fs.writeFileSync(path.join(hooksDir, 'permission-ask.sh'), '');
    fs.writeFileSync(path.join(hooksDir, 'unknown-event.sh'), '');
    fs.writeFileSync(path.join(hooksDir, 'tool-execute-before.sh'), '');
    fs.writeFileSync(path.join(hooksDir, 'tool-execute-before.ps1'), '');

    expect(() => scanHooks(hooksDir)).toThrow(/7 invalid entries/);
    const report = scanHooks(hooksDir, { mode: HookDigestMode.Report });
    expect(report.entries.map((e) => e.event)).toEqual(['session.idle']);
    expect(report.failures.length).toBe(7);
  });
});
