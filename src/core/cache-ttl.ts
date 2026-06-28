/**
 * cache-ttl.ts — Política de expiração do cache canônico do juiz LLM. Pura e
 * testável (sem Prisma, sem env): o engine lê as envs e passa os valores aqui.
 *
 * Por que existe: o cache por canonicalHash nunca reavaliava um veredito. Vagas
 * julgadas no modo raso antigo (/no_think) ficavam com score velho pra sempre.
 * O TTL força reavaliação periódica sem cron extra — acontece na própria coleta.
 */

export const DAY_MS = 86_400_000;

/**
 * Decide se um veredito em cache deve ser IGNORADO (→ reavaliar pelo LLM).
 *
 * - `ttlDays <= 0`  → cache infinito (comportamento legado, backward-compatible).
 * - `judgedAt` presente → stale se mais velho que `ttlDays`.
 * - `judgedAt` null (legado: julgado antes do campo existir) → stale, MAS espalhado:
 *   só reavalia se o anúncio (`updatedAt`) for mais velho que `graceDays`. Isso
 *   distribui a avalanche de legados ao longo de `graceDays` em vez de reavaliar
 *   tudo na 1ª coleta. Sem `updatedAt` (ex.: adapters de e-mail) → reavalia já.
 */
export function isCacheStale(
  judgedAt: Date | null,
  updatedAt: Date | null,
  nowMs: number,
  ttlDays: number,
  graceDays: number,
): boolean {
  if (ttlDays <= 0) return false;
  if (judgedAt !== null) return judgedAt.getTime() < nowMs - ttlDays * DAY_MS;
  if (updatedAt === null) return true;
  return updatedAt.getTime() < nowMs - graceDays * DAY_MS;
}
