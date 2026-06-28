/**
 * purge.ts — Expurgo (hard-delete) agendado de vagas INACTIVE antigas.
 *
 * Política (decisão consciente desta sessão):
 *   • Só age sobre status INACTIVE (soft-delete do coletor: vaga sumiu da fonte).
 *   • NUNCA toca em status de curadoria humana (HUMAN_OWNED_STATUSES:
 *     REJECTED / APPROVED / GENERATING / GENERATED / APPLIED).
 *   • Critério de idade: `lastSeenAt` mais antigo que `days` dias.
 *
 * Distinto de db-clean-core (limpeza manual multi-critério via painel/CLI):
 * aqui é uma rotina enxuta e segura para o cron do worker.
 */

import { PrismaClient } from "@prisma/client";
import { HUMAN_OWNED_STATUSES } from "./db-clean-core";

/** Default quando PURGE_INACTIVE_DAYS não está no .env. */
export const PURGE_INACTIVE_DAYS_DEFAULT = 30;

export interface PurgeResult {
  /** Dias efetivamente aplicados (após sanitização). */
  days: number;
  /** Limite temporal: lastSeenAt < cutoff é elegível. */
  cutoff: Date;
  /** Quantas vagas foram removidas. */
  removed: number;
  /** IDs removidos (para log de auditoria). */
  ids: string[];
}

/**
 * Remove vagas INACTIVE não vistas há mais de `days` dias. Idempotente e seguro:
 * a cláusula `NOT status IN human-owned` é defesa em profundidade — INACTIVE já
 * não é human-owned, mas blinda contra mudanças futuras na máquina de estados.
 */
export async function purgeInactiveJobs(
  prisma: PrismaClient,
  days: number = PURGE_INACTIVE_DAYS_DEFAULT,
): Promise<PurgeResult> {
  const safeDays =
    Number.isFinite(days) && days >= 1 ? Math.floor(days) : PURGE_INACTIVE_DAYS_DEFAULT;
  const cutoff = new Date(Date.now() - safeDays * 86_400_000);

  const targets = await prisma.job.findMany({
    where: {
      status: "INACTIVE",
      lastSeenAt: { lt: cutoff },
      NOT: { status: { in: [...HUMAN_OWNED_STATUSES] } },
    },
    select: { id: true },
  });
  const ids = targets.map((t) => t.id);
  if (ids.length === 0) return { days: safeDays, cutoff, removed: 0, ids: [] };

  const res = await prisma.job.deleteMany({ where: { id: { in: ids } } });
  return { days: safeDays, cutoff, removed: res.count, ids };
}
