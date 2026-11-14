import { spyOn } from 'bun:test';
import type { Hooks } from '@opencode-ai/plugin';
import type { EnvironmentConfig } from '../../utils/environment-config.js';
import * as environmentConfig from '../../utils/environment-config.js';

export interface MockProcessOptions {
  readonly exitCode?: number;
  readonly onKill?: () => void;
}

export interface MockProcessController {
  readonly process: Record<string, unknown>;
  readonly exit: { readonly promise: Promise<number>; resolve: (code: number) => void };
  readonly killCount: () => number;
}

const DEFAULT_EXIT_CODE = 143;

export const createMockProcess = (options: MockProcessOptions = {}): MockProcessController => {
  const exit = Promise.withResolvers<number>();
  let killCount = 0;

  const processRecord: Record<string, unknown> = {
    pid: 12_345,
    kill: () => {
      killCount += 1;
      processRecord['signalCode'] = 'SIGTERM';
      options.onKill?.();
      exit.resolve(options.exitCode ?? DEFAULT_EXIT_CODE);
    },
    exited: exit.promise,
    stdout: new Response('').body,
    stderr: new Response('').body,
    signalCode: undefined,
  };

  return { process: processRecord, exit, killCount: () => killCount };
};

export const mockSpawn = (controller: MockProcessController) =>
  spyOn(Bun, 'spawn').mockImplementation(() => controller.process as unknown as ReturnType<typeof Bun.spawn>);

export const mockSpawnResult = (exitCode: number) =>
  spyOn(Bun, 'spawn').mockImplementation(
    () =>
      ({
        pid: 12_346,
        kill: () => {},
        exited: Promise.resolve(exitCode),
        stdout: new Response('').body,
        stderr: new Response('').body,
        signalCode: undefined,
      }) as unknown as ReturnType<typeof Bun.spawn>,
  );

export const spyOnEnvironmentConfig = (overrides: Partial<EnvironmentConfig>) =>
  spyOn(environmentConfig, 'createDefaultEnvironmentConfig').mockReturnValue(environmentConfig.createTestEnvironmentConfig(overrides));

export interface DispatchHandler {
  (input: unknown, output?: Record<string, unknown>): Promise<void>;
}

export const asDispatchHandlers = (handlers: Hooks): Record<string, DispatchHandler> => handlers as unknown as Record<string, DispatchHandler>;
