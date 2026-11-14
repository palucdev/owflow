import { HookEvent, isHostEventName, type HookEventName } from '../../types/hook-types.js';

export { HookFailureTracker, type FailureTrackerEntry } from './hook-failure-tracker.js';

export const ABORT_COOLDOWN_MS = 2000;
export const MAX_HOOK_FAILURES = 3;

const MAX_SUMMARY_CHARS = 200;
const TRUNCATED_PREFIX_CHARS = 197;

export const canAbortSessionForEvent = (event: HookEventName): boolean => !isHostEventName(event) && event !== HookEvent.Event;

export interface AbortSessionOptions {
  readonly event: HookEventName;
  readonly sessionID?: string;
  readonly scriptPath: string;
}

const resolveAbortSessionOptions = (
  eventOrOptions: HookEventName | AbortSessionOptions,
  rest: readonly (string | undefined)[],
): AbortSessionOptions => {
  if (typeof eventOrOptions === 'object') {
    return eventOrOptions;
  }
  const sessionID = rest[0];
  const scriptPath = rest[1] ?? '';
  return { event: eventOrOptions, sessionID, scriptPath };
};

export class SessionAbortController {
  private readonly abortingSessions = new Map<string, number>();

  constructor(private readonly endSession?: (sessionID: string) => Promise<void> | void) {}

  clearSession(sessionID: string): void {
    this.abortingSessions.delete(sessionID);
  }

  async abortSession(
    eventOrOptions: HookEventName | AbortSessionOptions,
    ...rest: readonly (string | undefined)[]
  ): Promise<void> {
    const { event, sessionID, scriptPath } = resolveAbortSessionOptions(eventOrOptions, rest);
    if (!sessionID || !this.endSession || !canAbortSessionForEvent(event)) {
      return;
    }
    const now = Date.now();
    const lastAbort = this.abortingSessions.get(sessionID);
    if (lastAbort !== undefined && now - lastAbort < ABORT_COOLDOWN_MS) {
      return;
    }
    this.abortingSessions.set(sessionID, now);
    try {
      await this.endSession(sessionID);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[owflow] hooks: failed to end session ${sessionID} after ${scriptPath} failed: ${message}`);
    }
  }

  dispose(): void {
    this.abortingSessions.clear();
  }
}

export const buildCircuitBreakerError = (scriptPath: string, reason: string): Error =>
  new Error(`Blocked: ${reason}. Hint: fix ${scriptPath} or wait for cooldown.`);

export const buildInterpreterUnavailableError = (scriptPath: string, label: string): Error =>
  new Error(
    `Blocked: hook ${scriptPath} cannot run: the ${label} interpreter is not available. ` +
      `Hint: install ${label} and restart OpenCode, or remove the script to stop failing closed.`,
  );

type ErrorRestArgument = string | HookEventName | undefined;

export interface SpawnErrorOptions {
  readonly scriptPath: string;
  readonly spawnErrorMessage: string;
  readonly event: HookEventName;
}

const resolveSpawnErrorArguments = (
  scriptPathOrOptions: string | SpawnErrorOptions,
  rest: readonly ErrorRestArgument[],
): SpawnErrorOptions => {
  if (typeof scriptPathOrOptions === 'object') {
    return scriptPathOrOptions;
  }
  const spawnErrorMessage = typeof rest[0] === 'string' ? rest[0] : '';
  const event = (rest[1] as HookEventName) ?? HookEvent.Event;
  return { scriptPath: scriptPathOrOptions, spawnErrorMessage, event };
};

export const buildSpawnError = (
  scriptPathOrOptions: string | SpawnErrorOptions,
  ...rest: readonly ErrorRestArgument[]
): Error => {
  const { scriptPath, spawnErrorMessage, event } = resolveSpawnErrorArguments(
    scriptPathOrOptions,
    rest,
  );
  const failPosture = canAbortSessionForEvent(event)
    ? 'failure ends the current session; fail closed'
    : 'failure recorded; fail closed';
  return new Error(
    `Blocked: failed to spawn hook ${scriptPath}: ${spawnErrorMessage}. Hint: fix the failing script ${scriptPath} (${failPosture}), or remove it and restart OpenCode to proceed.`,
  );
};

export interface ProcessFailureErrorOptions {
  readonly scriptPath: string;
  readonly reason: string | undefined;
  readonly event: HookEventName;
}

const resolveProcessFailureArguments = (
  scriptPathOrOptions: string | ProcessFailureErrorOptions,
  rest: readonly ErrorRestArgument[],
): ProcessFailureErrorOptions => {
  if (typeof scriptPathOrOptions === 'object') {
    return scriptPathOrOptions;
  }
  const reason = typeof rest[0] === 'string' ? rest[0] : undefined;
  const event = (rest[1] as HookEventName) ?? HookEvent.Event;
  return { scriptPath: scriptPathOrOptions, reason, event };
};

const extractSummary = (reason: string | undefined, defaultSummary: string): string => {
  if (!reason) {
    return defaultSummary;
  }
  const firstLine = reason
    .split('\n')
    .find((logLine) => logLine.trim().length > 0)
    ?.trim();

  if (!firstLine) {
    return defaultSummary;
  }

  if (firstLine.length > MAX_SUMMARY_CHARS) {
    return `${firstLine.slice(0, TRUNCATED_PREFIX_CHARS)}...`;
  }

  return firstLine;
};

export const buildProcessFailureError = (
  scriptPathOrOptions: string | ProcessFailureErrorOptions,
  ...rest: readonly ErrorRestArgument[]
): Error => {
  const { scriptPath, reason, event } = resolveProcessFailureArguments(scriptPathOrOptions, rest);
  const summary = extractSummary(reason, reason || `hook ${scriptPath} failed`);
  const body = summary.startsWith('Blocked:') ? summary : `Blocked: ${summary}`;
  const failPosture = canAbortSessionForEvent(event)
    ? 'failure ends the current session; fail closed'
    : 'failure recorded; fail closed';
  const punctuation = body.endsWith('.') ? '' : '.';
  return new Error(
    `${body}${punctuation} Hint: fix the failing script ${scriptPath} (${failPosture}), or remove it and restart OpenCode to proceed.`,
  );
};
