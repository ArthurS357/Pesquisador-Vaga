import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/db/prisma";
import { JobCard } from "./JobCard";
import {
  buildQuery, parseFilters, PAGE_SIZE, QUEUE_STATUS_LIST,
  type JobFilterState, type RawParams, type SortKey,
} from "@/app/view";

function orderFor(sort: SortKey): Prisma.JobOrderByWithRelationInput[] {
  switch (sort) {
    case "recent": return [{ lastSeenAt: "desc" }];
    case "company": return [{ company: "asc" }, { score: "desc" }];
    case "title": return [{ title: "asc" }];
    default: return [{ score: "desc" }, { lastSeenAt: "desc" }];
  }
}

function EmptyDb() {
  return (
    <div className="state">
      <span className="state-icon">📭</span>
      <p>Nenhuma vaga no banco ainda.</p>
      <p>Rode a coleta com <code>npm run collect</code> e atualize esta página.</p>
    </div>
  );
}

function EmptyFiltered() {
  return (
    <div className="state">
      <span className="state-icon">🔍</span>
      <p>Nenhuma vaga corresponde aos filtros.</p>
      <p><Link href="/">Limpar filtros</Link> para ver a fila completa.</p>
    </div>
  );
}

function Pager({ state, total }: { state: JobFilterState; total: number }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages <= 1) return null;
  const prev = Math.max(1, state.page - 1);
  const next = Math.min(pages, state.page + 1);
  return (
    <nav className="pager" aria-label="Paginação">
      <Link
        className="btn"
        href={buildQuery(state, { page: prev })}
        aria-disabled={state.page <= 1}
        aria-label="Página anterior"
      >
        ← Anterior
      </Link>
      <span className="page-info">Página {state.page} de {pages}</span>
      <Link
        className="btn"
        href={buildQuery(state, { page: next })}
        aria-disabled={state.page >= pages}
        aria-label="Próxima página"
      >
        Próxima →
      </Link>
    </nav>
  );
}

export async function JobList({ searchParams }: { searchParams: RawParams }) {
  const state = parseFilters(searchParams);

  const where: Prisma.JobWhereInput = {
    status: { in: QUEUE_STATUS_LIST },
    ...(state.min > 0 ? { score: { gte: state.min } } : {}),
    ...(state.sources.length ? { source: { in: state.sources } } : {}),
    ...(state.lenses.length ? { lens: { in: state.lenses } } : {}),
  };

  const [totalInDb, total, jobs] = await Promise.all([
    prisma.job.count(),
    prisma.job.count({ where }),
    prisma.job.findMany({
      where,
      orderBy: orderFor(state.sort),
      skip: (state.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  if (totalInDb === 0) return <EmptyDb />;
  if (total === 0) return <EmptyFiltered />;

  const start = (state.page - 1) * PAGE_SIZE + 1;
  const end = start + jobs.length - 1;

  return (
    <>
      <div className="filters-foot">
        <span className="count">Mostrando {start}–{end} de {total} vaga(s)</span>
      </div>
      <div className="grid" aria-live="polite">
        {jobs.map((job) => (
          <JobCard key={job.id} job={job} />
        ))}
      </div>
      <Pager state={state} total={total} />
    </>
  );
}
