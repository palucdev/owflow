export interface FailureTrackerEntry {
  readonly event: string;
  readonly checkKey: string;
  readonly sessionID?: string;
}

const formatTrackerKey = (components: FailureTrackerEntry): string => {
  const sessionID = components.sessionID ?? 'global';
  return `${components.event}::${components.checkKey}::${sessionID}`;
};

const resolveTrackerKey = (
  eventOrEntry: FailureTrackerEntry | string,
  rest: readonly (string | undefined)[],
): string => {
  if (typeof eventOrEntry === 'object') {
    return formatTrackerKey(eventOrEntry);
  }
  const checkKey = rest[0] ?? '';
  const sessionID = rest[1] && rest[1].length > 0 ? rest[1] : 'global';
  return formatTrackerKey({ event: eventOrEntry, checkKey, sessionID });
};

export class HookFailureTracker {
  private readonly failures = new Map<string, number>();

  recordFailure(
    eventOrEntry: FailureTrackerEntry | string,
    ...rest: readonly (string | undefined)[]
  ): number {
    const sessionKey = resolveTrackerKey(eventOrEntry, rest);
    const nextCount = (this.failures.get(sessionKey) ?? 0) + 1;
    this.failures.set(sessionKey, nextCount);
    return nextCount;
  }

  recordSuccess(
    eventOrEntry: FailureTrackerEntry | string,
    ...rest: readonly (string | undefined)[]
  ): void {
    const sessionKey = resolveTrackerKey(eventOrEntry, rest);
    this.failures.delete(sessionKey);
  }

  getCount(
    eventOrEntry: FailureTrackerEntry | string,
    ...rest: readonly (string | undefined)[]
  ): number {
    const sessionKey = resolveTrackerKey(eventOrEntry, rest);
    return this.failures.get(sessionKey) ?? 0;
  }

  clear(): void {
    this.failures.clear();
  }
}
