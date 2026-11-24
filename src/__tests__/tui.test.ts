import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import tuiModule, { registerActiveHooksSidebar } from '../tui.js';
import { loadSolidRuntime } from '../tui/primitives.js';
import { makeFakeApi, makeSolid, noop } from './tui/primitives.js';
import { createWorkspaceHarness } from './tui/workspace.js';

const SIDEBAR_SLOT_ORDER = 50;

const workspaceHarness = createWorkspaceHarness('tui');

beforeEach(() => {
  workspaceHarness.setup();
});

afterEach(() => {
  mock.restore();
  workspaceHarness.teardown();
});

test('should export default tui plugin module metadata', () => {
  expect(tuiModule.id).toBe('owflow');
  expect(typeof tuiModule.tui).toBe('function');
  expect('server' in tuiModule).toBe(false);
});

test('should warn and register nothing when the workspace directory is unavailable', async () => {
  const warnSpy = spyOn(console, 'warn').mockImplementation(noop);
  try {
    const { api: emptyDirectoryApi, slots } = makeFakeApi('');
    await tuiModule.tui(emptyDirectoryApi);
    expect(slots).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('workspace directory unavailable'));
  } finally {
    warnSpy.mockRestore();
  }
});

test('should warn and return false when the solid runtime is unavailable', async () => {
  const warnSpy = spyOn(console, 'warn').mockImplementation(noop);
  try {
    const { temporaryDirectory } = workspaceHarness.workspace();
    const { api } = makeFakeApi(temporaryDirectory);
    const isRegistered = await registerActiveHooksSidebar({api, directory: temporaryDirectory, loadSolid: async () => JSON.parse('null') as null});
    expect(isRegistered).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('TUI Solid runtime unavailable'));
  } finally {
    warnSpy.mockRestore();
  }
});

test('should register the sidebar via tuiModule.tui with a valid directory and imported runtime', async () => {
  const { temporaryDirectory } = workspaceHarness.workspace();
  const { api, slots } = makeFakeApi(temporaryDirectory);
  const { runtime } = makeSolid();
  mock.module('@opentui/solid', () => runtime);

  await tuiModule.tui(api);
  expect(slots).toHaveLength(1);
  expect(slots[0]!.order).toBe(SIDEBAR_SLOT_ORDER);
});

test('loadSolidRuntime should resolve onCleanup directly from @opentui/solid when available', async () => {
  const onCleanup = noop;
  const solidModule = {
    createElement: () => ({}),
    insert: noop,
    setProp: noop,
    onCleanup,
  };

  const runtime = await loadSolidRuntime(async () => solidModule);
  expect(runtime).not.toBeNull();
  expect(runtime?.onCleanup).toBe(onCleanup);
});

test('loadSolidRuntime should fall back to solid-js for onCleanup when @opentui/solid does not export it', async () => {
  const onCleanup = noop;
  const solidModule = {
    createElement: () => ({}),
    insert: noop,
    setProp: noop,
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

test('loadSolidRuntime should return a runtime without onCleanup when neither exports it', async () => {
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

test('loadSolidRuntime should return null and warn when importing @opentui/solid fails', async () => {
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
