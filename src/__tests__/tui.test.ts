import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tuiModule, { registerActiveHooksSidebar } from '../tui.js';
import { loadSolidRuntime } from '../tui/primitives.js';
import { makeFakeApi, makeSolid } from './tui/primitives.js';

const SIDEBAR_SLOT_ORDER = 50;
const NO_SOLID_RUNTIME = JSON.parse('null') as null;
const noop = (): void => {};

const workspace = { directory: '' };

beforeEach(() => {
  workspace.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'owflow-tui-test-'));
  fs.mkdirSync(path.join(workspace.directory, '.owflow', 'hooks'), { recursive: true });
});

afterEach(() => {
  mock.restore();
  if (fs.existsSync(workspace.directory)) {
    fs.rmSync(workspace.directory, { recursive: true, force: true });
  }
});

describe('TUI module metadata', () => {
  test('should export default tui plugin module metadata', () => {
    expect(tuiModule.id).toBe('owflow');
    expect(typeof tuiModule.tui).toBe('function');
    expect('server' in tuiModule).toBe(false);
  });
});

describe('TUI module registration', () => {
  test('should warn and exit gracefully when directory is empty or solid runtime is unavailable', async () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(noop);

    try {
      // Missing directory
      const { api: emptyDirectoryApi, slots } = makeFakeApi('');
      await tuiModule.tui(emptyDirectoryApi);
      expect(slots).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('workspace directory unavailable'));

      // Solid runtime returns null
      const { api: validApi } = makeFakeApi(workspace.directory);
      const isRegistered = await registerActiveHooksSidebar(validApi, workspace.directory, async () => NO_SOLID_RUNTIME);
      expect(isRegistered).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('TUI Solid runtime unavailable'));
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('should register sidebar via tuiModule.tui with valid directory and imported runtime', async () => {
    const { api, slots } = makeFakeApi(workspace.directory);
    const { runtime } = makeSolid();
    mock.module('@opentui/solid', () => runtime);

    await tuiModule.tui(api);
    expect(slots).toHaveLength(1);
    expect(slots[0].order).toBe(SIDEBAR_SLOT_ORDER);
  });
});

describe('loadSolidRuntime cleanup resolution', () => {
  test('should resolve onCleanup directly from @opentui/solid when available', async () => {
    const solidModule = {
      createElement: () => ({}),
      insert: noop,
      setProp: noop,
      onCleanup: noop,
    };

    const runtime = await loadSolidRuntime(async () => solidModule);
    expect(runtime).not.toBeNull();
    expect(runtime?.onCleanup).toBe(noop);
  });

  test('should fall back to solid-js for onCleanup when @opentui/solid does not export it', async () => {
    const solidModule = {
      createElement: () => ({}),
      insert: noop,
      setProp: noop,
    };
    const solidJsModule = {
      onCleanup: noop,
    };

    const runtime = await loadSolidRuntime(
      async () => solidModule,
      async () => solidJsModule,
    );
    expect(runtime).not.toBeNull();
    expect(runtime?.onCleanup).toBe(noop);
  });
});

describe('loadSolidRuntime fallback behavior', () => {
  test('should return runtime without onCleanup when neither exports it', async () => {
    const solidModule = {
      createElement: () => ({}),
      insert: noop,
      setProp: noop,
    };
    const solidJsModule = {};

    const runtime = await loadSolidRuntime(
      async () => solidModule,
      async () => solidJsModule,
    );
    expect(runtime).not.toBeNull();
    expect(runtime?.onCleanup).toBeUndefined();
  });

  test('should return null and warn when importing @opentui/solid fails', async () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(noop);
    try {
      const runtime = await loadSolidRuntime(async () => {
        throw new Error('Module not found');
      });
      expect(runtime).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to import @opentui/solid'), expect.any(Error));
    } finally {
      warnSpy.mockRestore();
    }
  });
});
