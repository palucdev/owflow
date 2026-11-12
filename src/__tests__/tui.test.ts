import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tuiModule, { registerActiveHooksSidebar } from '../tui.js';
import { loadSolidRuntime } from '../tui/primitives.js';
import { makeFakeApi, makeSolid } from './tui/primitives.js';

describe('TUI module', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'owflow-tui-test-'));
    fs.mkdirSync(path.join(tmpDir, '.owflow', 'hooks'), { recursive: true });
  });

  afterEach(() => {
    mock.restore();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('should export default tui plugin module metadata', () => {
    expect(tuiModule.id).toBe('owflow');
    expect(typeof tuiModule.tui).toBe('function');
    expect('server' in tuiModule).toBe(false);
  });

  test('should warn and exit gracefully when directory is empty or solid runtime is unavailable', async () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    try {
      // Missing directory
      const { api: emptyDirApi, slots } = makeFakeApi('');
      await tuiModule.tui(emptyDirApi);
      expect(slots).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('workspace directory unavailable'));

      // Solid runtime returns null
      const { api: validApi } = makeFakeApi(tmpDir);
      const result = await registerActiveHooksSidebar(validApi, tmpDir, async () => null);
      expect(result).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('TUI Solid runtime unavailable'));
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('should register sidebar via tuiModule.tui with valid directory and imported runtime', async () => {
    const { api, slots } = makeFakeApi(tmpDir);
    const { runtime } = makeSolid();
    mock.module('@opentui/solid', () => runtime);

    await tuiModule.tui(api);
    expect(slots).toHaveLength(1);
    expect(slots[0].order).toBe(50);
  });

  describe('loadSolidRuntime', () => {
    test('should resolve onCleanup directly from @opentui/solid when available', async () => {
      const onCleanup = () => {};
      const solidModule = {
        createElement: () => ({}),
        insert: () => {},
        setProp: () => {},
        onCleanup,
      };

      const runtime = await loadSolidRuntime(async () => solidModule);
      expect(runtime).not.toBeNull();
      expect(runtime?.onCleanup).toBe(onCleanup);
    });

    test('should fall back to solid-js for onCleanup when @opentui/solid does not export it', async () => {
      const onCleanup = () => {};
      const solidModule = {
        createElement: () => ({}),
        insert: () => {},
        setProp: () => {},
      };
      const solidJsModule = {
        onCleanup,
      };

      const runtime = await loadSolidRuntime(
        async () => solidModule,
        async () => solidJsModule,
      );
      expect(runtime).not.toBeNull();
      expect(runtime?.onCleanup).toBe(onCleanup);
    });

    test('should return runtime without onCleanup when neither exports it', async () => {
      const solidModule = {
        createElement: () => ({}),
        insert: () => {},
        setProp: () => {},
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
      const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
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
});
