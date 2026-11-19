import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_HOOK_TIMEOUT_MS,
  HOOK_TIMEOUT_ENV,
  HookSpawnError,
  buildExecutionArgs as buildExecutionArguments,
  executeHookProcess,
} from '../../../hooks/runtime/process-executor.js';
import { HookEvent, type HookRegistryEntry } from '../../../types/hook-types.js';
import { removeScratchDirectory } from '../../fixtures/hooks/scratch-cleanup.js';
import { bashInterpreter } from '../../fixtures/hooks/platform-support.js';

const EXPECTED_TIMEOUT_MS = 120_000;
const TEST_TIMEOUT_MS = 10_000;
const EXIT_FAILURE_CODE = 2;
const EXECUTABLE_MODE = 0o755;
const SCRATCH_ROOT = path.join(process.cwd(), '.test-scratch', 'process-executor');

interface EntryOptions {
  scriptPath: string;
  resolved: string;
  expected: string;
}

const makeEntry = ({ scriptPath, resolved, expected }: EntryOptions): HookRegistryEntry => ({
  path: scriptPath,
  event: HookEvent.ToolExecuteBefore,
  interpreter: { resolved, expected, available: true },
  status: 'registered',
});

fs.rmSync(SCRATCH_ROOT, { recursive: true, force: true });
fs.mkdirSync(SCRATCH_ROOT, { recursive: true });

afterAll(() => {
  removeScratchDirectory(SCRATCH_ROOT);
});

describe('process-executor (documented timeout constants)', () => {
  test('exports the documented timeout constants', () => {
    expect(DEFAULT_HOOK_TIMEOUT_MS).toBe(EXPECTED_TIMEOUT_MS);
    expect(HOOK_TIMEOUT_ENV).toBe('OWFLOW_HOOK_TIMEOUT_MS');
  });
});

describe('process-executor (argument building)', () => {
  const pwshFlags = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File'];

  test('prepends PowerShell execution flags for .ps1 scripts', () => {
    const entry = makeEntry({ scriptPath: '/workspace/.owflow/hooks/tool-execute-before.ps1', resolved: '/usr/bin/pwsh', expected: 'pwsh' });
    expect(buildExecutionArguments(entry)).toEqual(['/usr/bin/pwsh', ...pwshFlags, entry.path]);
  });

  test('prepends PowerShell execution flags when interpreter is powershell.exe', () => {
    const entry = makeEntry({
      scriptPath: 'C:\\workspace\\.owflow\\hooks\\session-idle.ps1',
      resolved: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      expected: 'powershell.exe',
    });
    expect(buildExecutionArguments(entry)).toEqual(['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ...pwshFlags, entry.path]);
  });

  test('prepends PowerShell execution flags when expected interpreter is pwsh even with non-standard path', () => {
    const entry = makeEntry({
      scriptPath: '/workspace/.owflow/hooks/custom-script',
      resolved: '/opt/microsoft/powershell/7/pwsh',
      expected: 'pwsh',
    });
    expect(buildExecutionArguments(entry)).toEqual(['/opt/microsoft/powershell/7/pwsh', ...pwshFlags, entry.path]);
  });

  test('returns standard [resolved, path] arguments for non-PowerShell scripts', () => {
    const entry = makeEntry({ scriptPath: '/workspace/.owflow/hooks/tool-execute-before.sh', resolved: '/bin/bash', expected: 'bash' });
    expect(buildExecutionArguments(entry)).toEqual(['/bin/bash', entry.path]);
  });
});

describe('process-executor (spawn failures)', () => {
  test('executeHookProcess throws HookSpawnError when process cannot be spawned', async () => {
    const root = path.join(SCRATCH_ROOT, 'spawn-failure');
    const entry: HookRegistryEntry = {
      path: path.join(root, 'nonexistent.sh'),
      event: HookEvent.ToolExecuteBefore,
      interpreter: {
        resolved: '/nonexistent/interpreter',
        expected: 'bash',
        available: false,
      },
      status: 'registered',
    };

    const spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
      throw new Error('ENOENT: spawn failed');
    });

    try {
      await expect(
        executeHookProcess({
          entry,
          directory: root,
          stdinText: '{}',
          event: HookEvent.ToolExecuteBefore,
        }),
      ).rejects.toBeInstanceOf(HookSpawnError);
    } finally {
      spawnSpy.mockRestore();
    }
  });
});

describe('process-executor (real script execution)', () => {
  test.skipIf(bashInterpreter === null)('executeHookProcess runs a real script and reports success with stdout and stderr', async () => {
    const root = path.join(SCRATCH_ROOT, 'real-ok');
    fs.mkdirSync(root, { recursive: true });
    const scriptPath = path.join(root, 'ok.sh');
    fs.writeFileSync(scriptPath, '#!/usr/bin/env bash\necho "out line"\necho "warn line" >&2\nexit 0\n', { mode: EXECUTABLE_MODE });
    const entry: HookRegistryEntry = {
      path: scriptPath,
      event: HookEvent.ToolExecuteBefore,
      interpreter: { resolved: bashInterpreter!, expected: 'bash', available: true },
      status: 'registered',
    };

    const result = await executeHookProcess({
      entry,
      directory: root,
      stdinText: '{}',
      event: HookEvent.ToolExecuteBefore,
      timeoutMs: TEST_TIMEOUT_MS,
    });

    expect(result.isOk).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.reason).toBeUndefined();
    expect(result.rawStdout).toBe('out line\n');
    expect(result.rawStderr).toBe('warn line\n');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test.skipIf(bashInterpreter === null)('executeHookProcess reports failure reason from stderr and non-zero exit codes', async () => {
    const root = path.join(SCRATCH_ROOT, 'real-fail');
    fs.mkdirSync(root, { recursive: true });
    const scriptPath = path.join(root, 'fail.sh');
    fs.writeFileSync(scriptPath, '#!/usr/bin/env bash\necho "gate failed" >&2\nexit 2\n', { mode: EXECUTABLE_MODE });
    const entry: HookRegistryEntry = {
      path: scriptPath,
      event: HookEvent.ToolExecuteBefore,
      interpreter: { resolved: bashInterpreter!, expected: 'bash', available: true },
      status: 'registered',
    };

    const result = await executeHookProcess({
      entry,
      directory: root,
      stdinText: '{}',
      event: HookEvent.ToolExecuteBefore,
      timeoutMs: TEST_TIMEOUT_MS,
    });

    expect(result.isOk).toBe(false);
    expect(result.exitCode).toBe(EXIT_FAILURE_CODE);
    expect(result.reason).toBe('gate failed');
  });
});
