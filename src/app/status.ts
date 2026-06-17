/**
 * Máquina de estados da curadoria, mapeada no campo Job.status (String).
 * Sem enum no Prisma — strings simples, conforme schema existente.
 *
 *   ACTIVE ──┬─▶ REJECTED        (curadoria humana descarta)
 *            └─▶ APPROVED ─▶ GENERATING ─▶ GENERATED ─▶ APPLIED
 *
 *   GENERATING = carta sendo redigida pelo LLM.
 *   GENERATED  = carta no disco, aguardando revisão/envio humano.
 *   APPLIED    = humano confirmou o envio no painel.
 *   INACTIVE   = vaga sumiu da fonte (gerada pelo coletor CLI). Fica oculta.
 */
export const JOB_STATUS = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  APPROVED: "APPROVED",
  GENERATING: "GENERATING",
  GENERATED: "GENERATED",
  APPLIED: "APPLIED",
  REJECTED: "REJECTED",
} as const;

export type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS];

/** Fila de curadoria: o que ainda precisa de decisão humana. */
export const QUEUE_STATUSES = [JOB_STATUS.ACTIVE, JOB_STATUS.APPROVED] as const;

/** Histórico de candidaturas: o que já saiu da fila. */
export const HISTORY_STATUSES = [
  JOB_STATUS.GENERATING,
  JOB_STATUS.GENERATED,
  JOB_STATUS.APPLIED,
  JOB_STATUS.REJECTED,
] as const;
