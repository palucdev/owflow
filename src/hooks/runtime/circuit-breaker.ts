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

const resolveTiming = (invocation: CircuitBreakerInvocation): { startedAt: number; finishedAt: number } => {
  return {
    startedAt: invocation.startedAt ?? Date.now(),
    finishedAt: invocation.finishedAt ?? Date.now(),
  };
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

  private resolveKey(invocation: CircuitBreakerInvocation): { circuitKey: string; event: string; scriptPath: string } {
    const circuitKey = buildKey(invocation);
    return { circuitKey, event: invocation.event, scriptPath: invocation.scriptPath };
  }

  check(invocation: CircuitBreakerInvocation): CircuitBreakerCheckResult {
    const { circuitKey, scriptPath } = this.resolveKey(invocation);
    const now = invocation.now ?? Date.now();

    const breaker = this.breakers.get(circuitKey);
    if (breaker && now < breaker.trippedUntil) {
      const reason = `Circuit breaker active for ${scriptPath} after ${CIRCUIT_BREAKER_THRESHOLD} rapid consecutive failures (cooldown until ${new Date(breaker.trippedUntil).toISOString()})`;
      return { tripped: true, reason };
    }
    return { tripped: false };
  }

  recordSuccess(invocation: CircuitBreakerInvocation): void {
    const { circuitKey } = this.resolveKey(invocation);
    this.breakers.delete(circuitKey);
  }

  recordFailure(invocation: CircuitBreakerInvocation): { trippedUntil: number; rapidFailures: number } {
    const { circuitKey, event, scriptPath } = this.resolveKey(invocation);
    const { startedAt, finishedAt } = resolveTiming(invocation);
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
