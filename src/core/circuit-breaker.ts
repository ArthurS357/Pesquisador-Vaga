/**
 * Circuit Breaker em memória — blindagem de liveness (Proposta C do Dossiê).
 *
 * Fonte que falha N vezes consecutivas → o disjuntor ABRE para aquela chave por
 * um cooldown. Enquanto aberto, toda chamada sofre fast-fail imediato (sem gastar
 * socket, I/O ou event loop). Passado o cooldown → half-open: 1 tentativa de prova;
 * sucesso fecha, falha reabre por todo o cooldown.
 *
 * Singleton de processo no caller → estado sobrevive entre ticks do worker (cron).
 */

export interface CircuitBreakerOptions {
  /** Falhas consecutivas até abrir (default 3). */
  failureThreshold?: number;
  /** Tempo aberto antes do half-open, ms (default 5min). */
  cooldownMs?: number;
}

export type BreakerPhase = "closed" | "open" | "half-open";

interface BreakerState {
  failures: number;
  openedAt: number | null;
}

export class CircuitBreaker {
  private readonly states = new Map<string, BreakerState>();
  private readonly threshold: number;
  private readonly cooldownMs: number;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.threshold = opts.failureThreshold ?? 3;
    this.cooldownMs = opts.cooldownMs ?? 5 * 60_000;
  }

  private stateOf(key: string): BreakerState {
    let s = this.states.get(key);
    if (!s) {
      s = { failures: 0, openedAt: null };
      this.states.set(key, s);
    }
    return s;
  }

  /** Fase atual da chave, já considerando o cooldown. */
  phase(key: string): BreakerPhase {
    const s = this.stateOf(key);
    if (s.openedAt === null) return "closed";
    return Date.now() - s.openedAt >= this.cooldownMs ? "half-open" : "open";
  }

  /**
   * Roda `fn` sob proteção do disjuntor.
   * - OPEN  → fast-fail imediato (não chama `fn`, não abre socket).
   * - CLOSED/HALF-OPEN → executa; sucesso fecha, falha conta (e abre no limite).
   */
  async exec<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (this.phase(key) === "open") {
      const s = this.stateOf(key);
      const leftMs = this.cooldownMs - (Date.now() - (s.openedAt ?? 0));
      throw new Error(
        `CircuitBreaker[${key}] ABERTO — fast-fail (${Math.ceil(leftMs / 1000)}s p/ próxima tentativa)`,
      );
    }
    try {
      const result = await fn();
      this.onSuccess(key);
      return result;
    } catch (err) {
      this.onFailure(key);
      throw err;
    }
  }

  private onSuccess(key: string): void {
    const s = this.stateOf(key);
    s.failures = 0;
    s.openedAt = null;
  }

  private onFailure(key: string): void {
    const s = this.stateOf(key);
    s.failures += 1;
    // Atingiu o limite (ou half-open que falhou de novo) → (re)abre o cooldown.
    if (s.failures >= this.threshold) s.openedAt = Date.now();
  }
}

/**
 * Deadline absoluto sobre uma promise. Estourou `ms` → rejeita e dispara
 * `onTimeout` (ex.: forçar `client.close()` p/ matar socket pendurado).
 * O perdedor da corrida tem o erro engolido p/ não virar unhandledRejection.
 */
export function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  onTimeout?: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try {
        onTimeout?.();
      } catch {
        /* erro de cleanup ignorado — já estamos abortando */
      }
      reject(new Error(`${label}: deadline de ${ms}ms estourado`));
    }, ms);
  });
  promise.catch(() => {}); // perdedor da corrida não vira unhandledRejection
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
