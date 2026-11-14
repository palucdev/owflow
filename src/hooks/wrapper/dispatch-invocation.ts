import type { HookEventName } from '../../types/hook-types.js';

export interface DispatchInvocation {
  readonly event: HookEventName;
  readonly input?: unknown;
  readonly output?: Record<string, unknown>;
  readonly sessionID?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const resolveDispatchInvocation = (
  invocationOrEvent: DispatchInvocation | HookEventName,
  rest: readonly unknown[],
): DispatchInvocation => {
  if (typeof invocationOrEvent === 'object') return invocationOrEvent;
  return {
    event: invocationOrEvent,
    input: rest[0],
    ...(isRecord(rest[1]) && { output: rest[1] }),
  };
};
