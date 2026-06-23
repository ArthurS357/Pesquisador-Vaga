import { Suspense } from "react";
import Link from "next/link";
import { prisma } from "@/db/prisma";
import { MarkAppliedButton } from "./HistoryActions";
import { JobFilters } from "@/components/JobFilters";
import { JobList, queueFiltersWhere } from "@/components/JobList";
import { JobGridSkeleton } from "@/components/JobCardSkeleton";
import { StatusTabs } from "@/components/StatusTabs";
import { CleanupPanel } from "@/components/CleanupPanel";
import { OverviewHero, type OverviewMetrics } from "@/components/OverviewHero";
import { collectorStatus } from "@/core/collector";
import { HISTORY_STATUSES, JOB_STATUS } from "./status";
import {
  fmtScore, lensClass, lensLabel, PAGE_SIZE, parseFilters, QUEUE_STATUS_LIST, scoreClass,
  type RawParams,
} from "./view";

// Sempre dados frescos do SQLite (curadoria muda o estado a cada ação).
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<RawParams> }) {
  const sp = await searchParams;
  const current = parseFilters(sp);

  const queueWhere = { status: { in: QUEUE_STATUS_LIST } };
  // Contagens por status respeitando os filtros atuais (menos o próprio status):
  // alimentam os badges das abas sem uma query extra por aba.
  const countWhere = { ...queueFiltersWhere(current), status: { in: QUEUE_STATUS_LIST } };
  const [sourceRows, lensRows, history, statusGroups, allStatusGroups] = await Promise.all([
    prisma.job.findMany({ where: queueWhere, select: { source: true }, distinct: ["source"], orderBy: { source: "asc" } }),
    prisma.job.findMany({ where: { ...queueWhere, lens: { not: null } }, select: { lens: true }, distinct: ["lens"], orderBy: { lens: "asc" } }),
    prisma.job.findMany({
      where: { status: { in: [...HISTORY_STATUSES] } },
      orderBy: { lastSeenAt: "desc" },
      take: 100,
      select: { id: true, score: true, lens: true, title: true, company: true, status: true },
    }),
    prisma.job.groupBy({ by: ["status"], where: countWhere, _count: { _all: true } }),
    // Contagens globais (sem filtro) para os indicadores do painel de controle.
    prisma.job.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const sources = sourceRows.map((r) => r.source);
  const lenses = lensRows.map((r) => r.lens).filter((l): l is string => l !== null);
  const countOf = (st: string) => statusGroups.find((g) => g.status === st)?._count._all ?? 0;
  const tabCounts: Record<string, number> = {
    all: statusGroups.reduce((n, g) => n + g._count._all, 0),
    [JOB_STATUS.ACTIVE]: countOf(JOB_STATUS.ACTIVE),
    [JOB_STATUS.APPROVED]: countOf(JOB_STATUS.APPROVED),
  };

  // ── Indicadores do painel de controle (sobre o banco inteiro) ───────────────
  const globalCountOf = (st: string) => allStatusGroups.find((g) => g.status === st)?._count._all ?? 0;
  const totalAll = allStatusGroups.reduce((n, g) => n + g._count._all, 0);
  const monitored = totalAll - globalCountOf(JOB_STATUS.INACTIVE); // vivas (menos expiradas)
  // "Aprovadas" = tudo que passou pela curadoria humana (APPROVED em diante).
  const approved =
    globalCountOf(JOB_STATUS.APPROVED) +
    globalCountOf(JOB_STATUS.GENERATING) +
    globalCountOf(JOB_STATUS.GENERATED) +
    globalCountOf(JOB_STATUS.APPLIED);
  const metrics: OverviewMetrics = {
    monitored,
    totalAll,
    active: globalCountOf(JOB_STATUS.ACTIVE),
    approved,
    conversionPct: monitored > 0 ? Math.round((approved / monitored) * 100) : 0,
  };

  // Rodapé de contagem da command bar — derivado dos counts já carregados
  // (current.status == um facet → tabCounts daquele status; null → all),
  // sem nenhuma query extra. Espelha o `total` que o JobList computa.
  const viewTotal = (current.status ? tabCounts[current.status] : tabCounts.all) ?? 0;
  const rangeEnd = Math.min(viewTotal, current.page * PAGE_SIZE);
  const rangeStart = viewTotal === 0 ? 0 : Math.min((current.page - 1) * PAGE_SIZE + 1, rangeEnd);

  return (
    <main className="wrap">
      <header className="site-header">
        <h1>Job Engine — Curadoria</h1>
        <span className="sub">fila ranqueada · curadoria human-in-the-loop</span>
      </header>

      <OverviewHero metrics={metrics} initialStatus={collectorStatus()} />

      <section className="command-bar" aria-label="Navegação e filtros da fila">
        <StatusTabs current={current} counts={tabCounts} />
        <JobFilters current={current} sources={sources} lenses={lenses} />
        {viewTotal > 0 && (
          <div className="command-bar-foot">
            Mostrando {rangeStart}–{rangeEnd} de {viewTotal} vaga(s)
          </div>
        )}
      </section>

      <Suspense key={JSON.stringify(sp)} fallback={<JobGridSkeleton />}>
        <JobList searchParams={sp} />
      </Suspense>

      <section className="history">
        <h2>Histórico ({history.length})</h2>
        {history.length === 0 ? (
          <p className="meta">Nenhuma candidatura disparada ou rejeitada ainda.</p>
        ) : (
          <div className="hist-list">
            {history.map((job) => {
              const hasArtifact = job.status === JOB_STATUS.GENERATED || job.status === JOB_STATUS.APPLIED;
              return (
                <div className="hist-row" key={job.id}>
                  <span className={`badge score ${scoreClass(job.score)}`}>{fmtScore(job.score)}</span>
                  <span className={`badge ${lensClass(job.lens)}`}>{lensLabel(job.lens)}</span>
                  <span className="grow">
                    <span className="title">{job.title}</span>
                    <span className="meta"> · {job.company}</span>
                  </span>
                  {/* Smoke test Tailwind: pílula de status via tokens-ponte
                      (bg-surface-2 / border-border / text-muted-foreground). */}
                  <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                    {job.status}
                  </span>
                  {hasArtifact && <Link href={`/job/${job.id}/artifact`}>Ler carta</Link>}
                  {job.status === JOB_STATUS.GENERATED && <MarkAppliedButton id={job.id} />}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <CleanupPanel />
    </main>
  );
}
