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

export class CircuitBreakerTracker {
  private readonly breakers = new Map<string, CircuitBreakerEntry>();

  private key(event: string, scriptPath: string, sessionID: string | undefined): string {
    return `${event}::${scriptPath}::${sessionID ?? 'global'}`;
  }

  check(event: string, scriptPath: string, sessionID: string | undefined, now = Date.now()): CircuitBreakerCheckResult {
    const breaker = this.breakers.get(this.key(event, scriptPath, sessionID));
    if (breaker && now < breaker.trippedUntil) {
      const reason = `Circuit breaker active for ${scriptPath} after ${CIRCUIT_BREAKER_THRESHOLD} rapid consecutive failures (cooldown until ${new Date(breaker.trippedUntil).toISOString()})`;
      return { tripped: true, reason };
    }
    return { tripped: false };
  }

  recordSuccess(event: string, scriptPath: string, sessionID: string | undefined): void {
    this.breakers.delete(this.key(event, scriptPath, sessionID));
  }

  recordFailure(
    event: string,
    scriptPath: string,
    sessionID: string | undefined,
    startedAt: number,
    finishedAt: number,
  ): { trippedUntil: number; rapidFailures: number } {
    const k = this.key(event, scriptPath, sessionID);
    const prev = this.breakers.get(k);
    const isRapid = prev !== undefined && startedAt - prev.lastFinishedAt <= CIRCUIT_BREAKER_RAPID_GAP_MS;
    const rapidFailures = isRapid ? prev.rapidFailures + 1 : 1;
    const trippedUntil = rapidFailures >= CIRCUIT_BREAKER_THRESHOLD ? finishedAt + CIRCUIT_BREAKER_COOLDOWN_MS : 0;

    this.breakers.set(k, {
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
