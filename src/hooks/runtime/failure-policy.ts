import { HookEvent, isHostEventName, type HookEventName } from '../../types/hook-types.js';

export { HookFailureTracker, type FailureTrackerEntry } from './hook-failure-tracker.js';

export const ABORT_COOLDOWN_MS = 2000;
export const MAX_HOOK_FAILURES = 3;

const MAX_SUMMARY_CHARS = 200;
const TRUNCATED_PREFIX_CHARS = 197;

export const canAbortSessionForEvent = (event: HookEventName): boolean => !isHostEventName(event) && event !== HookEvent.Event;

export interface AbortSessionOptions {
  readonly event: HookEventName;
  readonly scriptPath: string;
  readonly sessionID?: string;
}

export class SessionAbortController {
  private readonly abortingSessions = new Map<string, number>();

  constructor(private readonly endSession?: (sessionID: string) => Promise<void> | void) {}

  clearSession(sessionID: string): void {
    this.abortingSessions.delete(sessionID);
  }

  async abortSession(options: AbortSessionOptions): Promise<void> {
    const { event, sessionID, scriptPath } = options;
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

export interface SpawnErrorOptions {
  readonly event: HookEventName;
  readonly scriptPath: string;
  readonly spawnErrorMessage: string;
}

export const buildSpawnError = (options: SpawnErrorOptions): Error => {
  const { scriptPath, spawnErrorMessage, event } = options;
  const failPosture = canAbortSessionForEvent(event) ? 'failure ends the current session; fail closed' : 'failure recorded; fail closed';
  return new Error(
    `Blocked: failed to spawn hook ${scriptPath}: ${spawnErrorMessage}. Hint: fix the failing script ${scriptPath} (${failPosture}), or remove it and restart OpenCode to proceed.`,
  );
};

export interface ProcessFailureErrorOptions {
  readonly scriptPath: string;
  readonly reason: string | undefined;
  readonly event: HookEventName;
}

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

export const buildProcessFailureError = (options: ProcessFailureErrorOptions): Error => {
  const { scriptPath, reason, event } = options;
  const summary = extractSummary(reason, reason || `hook ${scriptPath} failed`);
  const body = summary.startsWith('Blocked:') ? summary : `Blocked: ${summary}`;
  const failPosture = canAbortSessionForEvent(event) ? 'failure ends the current session; fail closed' : 'failure recorded; fail closed';
  const punctuation = body.endsWith('.') ? '' : '.';
  return new Error(
    `${body}${punctuation} Hint: fix the failing script ${scriptPath} (${failPosture}), or remove it and restart OpenCode to proceed.`,
  );
};
