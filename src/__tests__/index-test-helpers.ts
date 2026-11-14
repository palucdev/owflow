import { spyOn } from 'bun:test';
import * as hooksWrapperModule from '../hooks/hooks-wrapper.js';
import type OwflowPlugin from '../index.js';

export type PluginInput = Parameters<typeof OwflowPlugin>[0];

export const NOOP = (): void => {};

export const mockPluginInput = (directory: string, client: Record<string, unknown> = {}): PluginInput =>
  ({
    ['$']: {},
    directory,
    client,
    project: {},
    worktree: directory,
    experimental_workspace: {},
    serverUrl: new URL('http://localhost'),
  }) as unknown as PluginInput;

export const mockWrapperConstructor = (
  createWrapper: (directory: string, endSession?: (sessionID: string) => Promise<void> | void) => Record<string, unknown>,
) => spyOn(hooksWrapperModule, 'default').mockImplementation(createWrapper as unknown as typeof hooksWrapperModule.default);
