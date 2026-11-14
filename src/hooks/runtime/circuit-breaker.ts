export const CIRCUIT_BREAKER_THRESHOLD = 4;
export const CIRCUIT_BREAKER_RAPID_GAP_MS = 500;
export const CIRCUIT_BREAKER_COOLDOWN_MS = 30_000;

export interface CircuitBreakerEntry {
  rapidFailures: number;
  lastFinishedAt: number;
  trippedUntil: number;
}

export interface CircuitBreakerCheckResult {
  tripped: boolean;
  reason?: string;
}

export interface CircuitBreakerInvocation {
  readonly event: string;
  readonly scriptPath: string;
  readonly sessionID?: string;
  readonly startedAt?: number;
  readonly finishedAt?: number;
  readonly now?: number;
}

interface KeyComponents {
  readonly event: string;
  readonly scriptPath: string;
  readonly sessionID?: string;
}

const buildKey = (components: KeyComponents): string => {
  const sessionID = components.sessionID ?? 'global';
  return `${components.event}::${components.scriptPath}::${sessionID}`;
};

const resolveNow = (
  invocationOrEvent: CircuitBreakerInvocation | string,
  rest: readonly unknown[],
): number => {
  if (typeof invocationOrEvent === 'object' && invocationOrEvent.now !== undefined) {
    return invocationOrEvent.now;
  }
  return typeof rest[2] === 'number' ? rest[2] : Date.now();
};

const resolveTiming = (
  invocationOrEvent: CircuitBreakerInvocation | string,
  rest: readonly unknown[],
): { startedAt: number; finishedAt: number } => {
  if (typeof invocationOrEvent === 'object') {
    return {
      startedAt: invocationOrEvent.startedAt ?? Date.now(),
      finishedAt: invocationOrEvent.finishedAt ?? Date.now(),
    };
  }
  const startedAt = typeof rest[2] === 'number' ? rest[2] : Date.now();
  const finishedAt = typeof rest[3] === 'number' ? rest[3] : Date.now();
  return { startedAt, finishedAt };
};

const calculateFailureState = (
  previous: CircuitBreakerEntry | undefined,
  timing: { startedAt: number; finishedAt: number },
): { rapidFailures: number; trippedUntil: number } => {
  const isRapid = previous !== undefined && timing.startedAt - previous.lastFinishedAt <= CIRCUIT_BREAKER_RAPID_GAP_MS;
  const rapidFailures = isRapid ? previous.rapidFailures + 1 : 1;
  const trippedUntil = rapidFailures >= CIRCUIT_BREAKER_THRESHOLD ? timing.finishedAt + CIRCUIT_BREAKER_COOLDOWN_MS : 0;
  return { rapidFailures, trippedUntil };
};

export class CircuitBreakerTracker {
  private readonly breakers = new Map<string, CircuitBreakerEntry>();

  private resolveKey(
    invocationOrEvent: CircuitBreakerInvocation | string,
    rest: readonly unknown[],
  ): { circuitKey: string; event: string; scriptPath: string } {
    if (typeof invocationOrEvent === 'object') {
      const circuitKey = buildKey(invocationOrEvent);
      return { circuitKey, event: invocationOrEvent.event, scriptPath: invocationOrEvent.scriptPath };
    }
    const scriptPath = typeof rest[0] === 'string' ? rest[0] : '';
    const sessionID = typeof rest[1] === 'string' && rest[1] ? rest[1] : 'global';
    const circuitKey = buildKey({ event: invocationOrEvent, scriptPath, sessionID });
    return { circuitKey, event: invocationOrEvent, scriptPath };
  }

  check(
    invocationOrEvent: CircuitBreakerInvocation | string,
    ...rest: readonly unknown[]
  ): CircuitBreakerCheckResult {
    const { circuitKey, scriptPath } = this.resolveKey(invocationOrEvent, rest);
    const now = resolveNow(invocationOrEvent, rest);

    const breaker = this.breakers.get(circuitKey);
    if (breaker && now < breaker.trippedUntil) {
      const reason = `Circuit breaker active for ${scriptPath} after ${CIRCUIT_BREAKER_THRESHOLD} rapid consecutive failures (cooldown until ${new Date(breaker.trippedUntil).toISOString()})`;
      return { tripped: true, reason };
    }
    return { tripped: false };
  }

  recordSuccess(
    invocationOrEvent: CircuitBreakerInvocation | string,
    ...rest: readonly (string | undefined)[]
  ): void {
    const { circuitKey } = this.resolveKey(invocationOrEvent, rest);
    this.breakers.delete(circuitKey);
  }

  recordFailure(
    invocationOrEvent: CircuitBreakerInvocation | string,
    ...rest: readonly (string | number | undefined)[]
  ): { trippedUntil: number; rapidFailures: number } {
    const { circuitKey, event, scriptPath } = this.resolveKey(invocationOrEvent, rest);
    const { startedAt, finishedAt } = resolveTiming(invocationOrEvent, rest);
    const previous = this.breakers.get(circuitKey);
    const { rapidFailures, trippedUntil } = calculateFailureState(previous, { startedAt, finishedAt });

    this.breakers.set(circuitKey, {
      rapidFailures,
      lastFinishedAt: finishedAt,
      trippedUntil,
    });

    if (trippedUntil > 0) {
      console.warn(
        `[owflow] hooks: circuit breaker tripped for ${scriptPath} on event "${event}" after ${rapidFailures} rapid failures; pausing for ${CIRCUIT_BREAKER_COOLDOWN_MS}ms.`,
      );
    }

    return { trippedUntil, rapidFailures };
  }

  clear(): void {
    this.breakers.clear();
  }
}
