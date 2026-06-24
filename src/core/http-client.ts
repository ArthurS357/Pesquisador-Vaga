/**
 * Cliente HTTP resiliente e "educado" (Polite Scraper) — Proposta A do Dossiê.
 *
 * Protege o IP local contra ban de WAF/ATS:
 *  - Rate limit por hostname (default 2 req/s no MESMO domínio).
 *  - Escudo anti-429: lê `Retry-After` (429/503) e pausa a fila daquele host.
 *  - Backoff exponencial + jitter pra outros 5xx / erros de rede.
 *  - User-Agent de cidadão-de-bem injetado quando ausente.
 *
 * Substitui `fetchWithTimeout` SÓ nos adaptadores de vagas. `fetchWithTimeout`
 * (utils) segue servindo ollama/resolveTrackingUrl — fora do escopo.
 */

/** Política de resiliência por chamada. Tudo opcional via `Partial`. */
export interface ResilientPolicy {
  /** Nº de retries APÓS a 1ª tentativa (default 3 → até 4 tentativas). */
  retries: number;
  /** Base do backoff exponencial, ms (default 1000). */
  baseDelayMs: number;
  /** Teto do backoff, ms (default 30_000). */
  maxDelayMs: number;
  /** Jitter aleatório somado ao backoff, ms (default 1000). */
  jitterMs: number;
  /** Timeout por tentativa, ms (default 10_000). */
  timeoutMs: number;
  /** UA injetado se a request não trouxer um. */
  userAgent: string;
}

const DEFAULT_POLICY: ResilientPolicy = {
  retries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  jitterMs: 1000,
  timeoutMs: 10_000,
  userAgent: "Pesquisa-Emprego-Bot/1.0 (+https://github.com/sabino/pesquisa-emprego)",
};

/** Espaçamento mínimo entre INÍCIOS de request ao mesmo host → 2 req/s. */
const PER_HOST_MIN_INTERVAL_MS = 500;

/**
 * Teto do sleep de Retry-After. Alvo pode pedir horas de pausa; não congelamos
 * a esteira local por isso. Dormimos no máximo 60s; se o alvo INSISTIR em pedir
 * além do teto numa 2ª resposta, abortamos a request.
 */
const MAX_RETRY_AFTER_MS = 60_000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Fila de rate limit por hostname. Cada host guarda o instante mais cedo em que
 * a PRÓXIMA request pode começar. A reserva (get→max→set) é síncrona, logo é
 * livre de corrida mesmo com vários `acquire` concorrentes (JS single-thread).
 */
class HostRateLimiter {
  private readonly nextStart = new Map<string, number>();

  constructor(private readonly minIntervalMs: number) {}

  /** Reserva um slot pro host e espera até a hora de começar. */
  async acquire(host: string): Promise<void> {
    const now = Date.now();
    const earliest = this.nextStart.get(host) ?? now;
    const startAt = Math.max(now, earliest);
    this.nextStart.set(host, startAt + this.minIntervalMs);
    const wait = startAt - now;
    if (wait > 0) await sleep(wait);
  }

  /** Empurra o host pra frente por `ms` (usado no Retry-After). */
  pause(host: string, ms: number): void {
    const until = Date.now() + ms;
    const cur = this.nextStart.get(host) ?? 0;
    this.nextStart.set(host, Math.max(cur, until));
  }
}

// Singleton de processo: o rate limit vale ENTRE adaptadores (mesmo host, mesma fila).
const limiter = new HostRateLimiter(PER_HOST_MIN_INTERVAL_MS);

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url; // URL malformada: trata a string toda como "host" (degrada são).
  }
}

/** Injeta UA educado só se a request não trouxer um (case-insensitive). */
function withUserAgent(init: RequestInit, userAgent: string): RequestInit {
  const headers = new Headers(init.headers);
  if (!headers.has("user-agent")) headers.set("user-agent", userAgent);
  return { ...init, headers };
}

/** Retry-After → ms. Aceita segundos (número) ou HTTP-date. Null se ausente/inválido. */
function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

/** delay = min(max, base * 2^attempt) + random*jitter. */
function backoffDelay(attempt: number, p: ResilientPolicy): number {
  const exp = Math.min(p.maxDelayMs, p.baseDelayMs * 2 ** attempt);
  return exp + Math.random() * p.jitterMs;
}

/** Uma tentativa com timeout próprio via AbortController. */
async function fetchOnce(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

const RETRYABLE_STATUS = new Set([429, 503]);

/**
 * `fetch` resiliente e educado. Mesma assinatura de `fetch` + política opcional.
 * Devolve a última `Response` quando esgota retries em status de erro (o adapter
 * decide via `res.ok`). Relança só em erro de rede/timeout na última tentativa —
 * preservando o esqueleto de erro dos adaptadores (allSettled no engine).
 */
export async function resilientFetch(
  url: string,
  init: RequestInit = {},
  policy: Partial<ResilientPolicy> = {},
): Promise<Response> {
  const p: ResilientPolicy = { ...DEFAULT_POLICY, ...policy };
  const host = hostOf(url);
  const reqInit = withUserAgent(init, p.userAgent);

  let lastError: unknown;
  // Já demos a 1 pausa-teto (Retry-After > 60s)? 2ª insistência → aborta.
  let longPauseGranted = false;

  for (let attempt = 0; attempt <= p.retries; attempt++) {
    await limiter.acquire(host);

    let res: Response;
    try {
      res = await fetchOnce(url, reqInit, p.timeoutMs);
    } catch (err) {
      // Erro de rede ou timeout (AbortError): backoff e retenta; relança no fim.
      lastError = err;
      if (attempt === p.retries) throw err;
      await sleep(backoffDelay(attempt, p));
      continue;
    }

    // 429 / 503 → escudo Retry-After (pausa o host) ou backoff.
    if (RETRYABLE_STATUS.has(res.status)) {
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
      const overCeiling = retryAfter !== null && retryAfter > MAX_RETRY_AFTER_MS;

      // Alvo já levou uma pausa-teto e SEGUE pedindo > 60s → aborta a request,
      // pra não pendurar a esteira local atrás de um cooldown de horas.
      if (overCeiling && longPauseGranted) {
        throw new Error(
          `resilientFetch: ${host} insiste em Retry-After acima do teto de 60s — abortado`,
        );
      }
      if (attempt === p.retries) return res;

      if (retryAfter !== null) {
        // Teto: alvo pede 2h → dormimos no máximo 60s.
        const waitMs = Math.min(retryAfter, MAX_RETRY_AFTER_MS);
        if (overCeiling) longPauseGranted = true;
        limiter.pause(host, waitMs);
        await sleep(waitMs);
      } else {
        await sleep(backoffDelay(attempt, p));
      }
      continue;
    }

    // Outros 5xx → backoff e retenta.
    if (res.status >= 500) {
      if (attempt === p.retries) return res;
      await sleep(backoffDelay(attempt, p));
      continue;
    }

    // 2xx/3xx/4xx (≠429): entrega. Adapter trata via `res.ok`.
    return res;
  }

  // Inalcançável (o loop sempre retorna ou relança), mas satisfaz o compilador.
  throw lastError instanceof Error ? lastError : new Error("resilientFetch: falha inesperada");
}
