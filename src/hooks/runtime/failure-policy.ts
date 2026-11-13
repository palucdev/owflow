import { HookEvent, isHostEventName, type HookEventName } from '../../types/hook-types.js';

export const ABORT_COOLDOWN_MS = 2_000;
export const MAX_HOOK_FAILURES = 3;

export const canAbortSessionForEvent = (event: HookEventName): boolean => !isHostEventName(event) && event !== HookEvent.Event;

export class HookFailureTracker {
  private readonly failures = new Map<string, number>();

  private key(event: string, checkKey: string, sessionID?: string): string {
    return `${event}::${checkKey}::${sessionID ?? 'global'}`;
  }

  recordFailure(event: string, checkKey: string, sessionID?: string): number {
    const k = this.key(event, checkKey, sessionID);
    const next = (this.failures.get(k) ?? 0) + 1;
    this.failures.set(k, next);
    return next;
  }

  recordSuccess(event: string, checkKey: string, sessionID?: string): void {
    this.failures.delete(this.key(event, checkKey, sessionID));
  }

  getCount(event: string, checkKey: string, sessionID?: string): number {
    return this.failures.get(this.key(event, checkKey, sessionID)) ?? 0;
  }

  clear(): void {
    this.failures.clear();
  }
}

export class SessionAbortController {
  private readonly abortingSessions = new Map<string, number>();

  constructor(private readonly endSession?: (sessionID: string) => Promise<void> | void) {}

  clearSession(sessionID: string): void {
    this.abortingSessions.delete(sessionID);
  }

  async abortSession(event: HookEventName, sessionID: string | undefined, scriptPath: string): Promise<void> {
    if (!this.endSession || !sessionID || !canAbortSessionForEvent(event)) return;
    const now = Date.now();
    const lastAbort = this.abortingSessions.get(sessionID);
    if (lastAbort !== undefined && now - lastAbort < ABORT_COOLDOWN_MS) return;
    this.abortingSessions.set(sessionID, now);
    try {
      await this.endSession(sessionID);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[owflow] hooks: failed to end session ${sessionID} after ${scriptPath} failed: ${msg}`);
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

export const buildSpawnError = (scriptPath: string, spawnErrMsg: string, event: HookEventName): Error => {
  const failPosture = canAbortSessionForEvent(event) ? 'failure ends the current session; fail closed' : 'failure recorded; fail closed';
  return new Error(
    `Blocked: failed to spawn hook ${scriptPath}: ${spawnErrMsg}. Hint: fix the failing script ${scriptPath} (${failPosture}), or remove it and restart OpenCode to proceed.`,
  );
};

export const buildProcessFailureError = (scriptPath: string, reason: string | undefined, event: HookEventName): Error => {
  const firstLine = reason
    ?.split('\n')
    .find((l) => l.trim().length > 0)
    ?.trim();
  const summary = firstLine ? (firstLine.length > 200 ? `${firstLine.slice(0, 197)}...` : firstLine) : reason || `hook ${scriptPath} failed`;
  const body = summary.startsWith('Blocked:') ? summary : `Blocked: ${summary}`;
  const failPosture = canAbortSessionForEvent(event) ? 'failure ends the current session; fail closed' : 'failure recorded; fail closed';
  return new Error(
    `${body.endsWith('.') ? body : `${body}.`} Hint: fix the failing script ${scriptPath} (${failPosture}), or remove it and restart OpenCode to proceed.`,
  );
};
