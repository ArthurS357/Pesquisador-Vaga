/**
 * db-clean-core.ts — Lógica pura de limpeza do banco, compartilhada entre
 * o script CLI (src/db-clean.ts) e a API route (/api/cleanup).
 *
 * Sem import de readline, process.argv ou dotenv — apenas Prisma + tipos.
 */

import { PrismaClient, Prisma } from "@prisma/client";

// ── Constantes ────────────────────────────────────────────────────────────────

/** Vagas cujo status foi definido por ação humana — nunca remover automaticamente. */
export const HUMAN_OWNED_STATUSES = [
  "APPROVED",
  "REJECTED",
  "GENERATING",
  "GENERATED",
  "APPLIED",
] as const;

export const OLDER_THAN_DEFAULT_DAYS = 30;

// ── Tipos públicos ────────────────────────────────────────────────────────────

export interface CleanupFilters {
  blocked?: boolean;   // status = 'INACTIVE'
  lowScore?: boolean;  // score <= 20 OR score IS NULL
  source?: string;     // source = <nome>
  olderThan?: number;  // lastSeenAt < N dias atrás
  all?: boolean;       // atalho para todos os critérios acima
}

export interface CriterionCount {
  key: "blocked" | "lowScore" | "source" | "olderThan";
  label: string;
  count: number;
}

export interface CleanupCounts {
  criteria: CriterionCount[];
  /** Total deduplicado (vagas que seriam removidas) */
  total: number;
  /** Vagas ignoradas por ter status humano */
  skipped: number;
}

// ── Filtros Prisma ────────────────────────────────────────────────────────────

interface CriterionDef {
  key: CriterionCount["key"];
  label: string;
  where: Prisma.JobWhereInput;
}

function buildCriterionDefs(filters: CleanupFilters): CriterionDef[] {
  const defs: CriterionDef[] = [];

  if (filters.blocked ?? filters.all) {
    defs.push({
      key: "blocked",
      label: "Inativas (status=INACTIVE)",
      where: { status: "INACTIVE" },
    });
  }

  if (filters.lowScore ?? filters.all) {
    defs.push({
      key: "lowScore",
      label: "Score baixo (≤20 ou não avaliadas)",
      where: { OR: [{ score: { lte: 20 } }, { score: null }] },
    });
  }

  if (filters.source) {
    defs.push({
      key: "source",
      label: `Fonte: ${filters.source}`,
      where: { source: filters.source },
    });
  }

  const days = filters.olderThan ?? (filters.all ? OLDER_THAN_DEFAULT_DAYS : undefined);
  if (days !== undefined) {
    const cutoff = new Date(Date.now() - days * 86_400_000);
    defs.push({
      key: "olderThan",
      label: `Não vistas há >${days} dias`,
      where: { lastSeenAt: { lt: cutoff } },
    });
  }

  return defs;
}

// ── Coleta IDs únicos elegíveis ───────────────────────────────────────────────

async function collectSafeIds(
  prisma: PrismaClient,
  defs: CriterionDef[]
): Promise<{ idSet: Set<string>; criterionCounts: Map<CriterionCount["key"], number> }> {
  const idSet = new Set<string>();
  const criterionCounts = new Map<CriterionCount["key"], number>();

  for (const def of defs) {
    const jobs = await prisma.job.findMany({
      where: def.where,
      select: { id: true },
    });
    criterionCounts.set(def.key, jobs.length);
    jobs.forEach((j) => idSet.add(j.id));
  }

  return { idSet, criterionCounts };
}

async function excludeHumanOwned(
  prisma: PrismaClient,
  ids: string[]
): Promise<{ safe: string[]; skipped: number }> {
  if (ids.length === 0) return { safe: [], skipped: 0 };
  const owned = await prisma.job.findMany({
    where: { id: { in: ids }, status: { in: [...HUMAN_OWNED_STATUSES] } },
    select: { id: true },
  });
  const ownedSet = new Set(owned.map((j) => j.id));
  return {
    safe: ids.filter((id) => !ownedSet.has(id)),
    skipped: ownedSet.size,
  };
}

// ── API pública ───────────────────────────────────────────────────────────────

/** Dry run — conta vagas que seriam removidas, sem deletar nada. */
export async function getCleanupCounts(
  prisma: PrismaClient,
  filters: CleanupFilters
): Promise<CleanupCounts> {
  const defs = buildCriterionDefs(filters);
  if (defs.length === 0) {
    return { criteria: [], total: 0, skipped: 0 };
  }

  const { idSet, criterionCounts } = await collectSafeIds(prisma, defs);
  const allIds = Array.from(idSet);
  const { safe, skipped } = await excludeHumanOwned(prisma, allIds);

  const criteria: CriterionCount[] = defs.map((def) => ({
    key: def.key,
    label: def.label,
    count: criterionCounts.get(def.key) ?? 0,
  }));

  return { criteria, total: safe.length, skipped };
}

/** Executa a remoção real e retorna quantas vagas foram deletadas por critério. */
export async function executeCleanup(
  prisma: PrismaClient,
  filters: CleanupFilters
): Promise<CleanupCounts> {
  const defs = buildCriterionDefs(filters);
  if (defs.length === 0) {
    return { criteria: [], total: 0, skipped: 0 };
  }

  const { idSet, criterionCounts: _ } = await collectSafeIds(prisma, defs);
  const allIds = Array.from(idSet);
  const { safe: toDelete, skipped } = await excludeHumanOwned(prisma, allIds);
  // Lookup O(1) por critério (substitui Array.includes O(n) dentro do filter).
  const toDeleteSet = new Set(toDelete);

  if (toDelete.length === 0) {
    const criteria: CriterionCount[] = defs.map((def) => ({
      key: def.key,
      label: def.label,
      count: 0,
    }));
    return { criteria, total: 0, skipped };
  }

  // Remover por critério para contagem granular
  const criteria: CriterionCount[] = [];
  let totalRemoved = 0;

  for (const def of defs) {
    const jobs = await prisma.job.findMany({
      where: def.where,
      select: { id: true },
    });
    const eligibleIds = jobs.map((j) => j.id).filter((id) => toDeleteSet.has(id));

    if (eligibleIds.length === 0) {
      criteria.push({ key: def.key, label: def.label, count: 0 });
      continue;
    }

    const result = await prisma.job.deleteMany({
      where: { id: { in: eligibleIds } },
    });
    totalRemoved += result.count;
    criteria.push({ key: def.key, label: def.label, count: result.count });
  }

  return { criteria, total: totalRemoved, skipped };
}

/** Lista as fontes distintas no banco (para o dropdown do painel). */
export async function listSources(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.job.findMany({
    select: { source: true },
    distinct: ["source"],
    orderBy: { source: "asc" },
  });
  return rows.map((r) => r.source);
}
