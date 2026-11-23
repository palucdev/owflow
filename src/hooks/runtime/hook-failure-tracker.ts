export interface FailureTrackerEntry {
  readonly event: string;
  readonly checkKey: string;
  readonly sessionID?: string;
}

const formatTrackerKey = (entry: FailureTrackerEntry): string => {
  const sessionID = entry.sessionID && entry.sessionID.length > 0 ? entry.sessionID : 'global';
  return `${entry.event}::${entry.checkKey}::${sessionID}`;
};

export class HookFailureTracker {
  private readonly failures = new Map<string, number>();

  recordFailure(entry: FailureTrackerEntry): number {
    const sessionKey = formatTrackerKey(entry);
    const nextCount = (this.failures.get(sessionKey) ?? 0) + 1;
    this.failures.set(sessionKey, nextCount);
    return nextCount;
  }

  recordSuccess(entry: FailureTrackerEntry): void {
    const sessionKey = formatTrackerKey(entry);
    this.failures.delete(sessionKey);
  }

  getCount(entry: FailureTrackerEntry): number {
    const sessionKey = formatTrackerKey(entry);
    return this.failures.get(sessionKey) ?? 0;
  }

  clear(): void {
    this.failures.clear();
  }
}
