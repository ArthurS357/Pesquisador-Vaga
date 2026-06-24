import Link from "next/link";
import { JOB_STATUS } from "@/app/status";
import { lensLabel } from "@/app/view";

/**
 * Painel de Início (Home Dashboard) — porta de entrada analítica.
 *
 * Server Component puro: deriva tudo em memória (reduce/filter) e desenha
 * "gráficos lineares nativos" (barras flexbox h-2 + width inline). Zero lib de
 * chart, zero estado de cliente → imune a re-render, latência zero. Todo o
 * visual amarra nos tokens do globals.css via classes Tailwind (accent/surface/
 * border/danger). A transição de view é client-side sem scroll jump (Link
 * scroll={false}) — ver page.tsx.
 */

/** Projeção mínima que o dashboard precisa (lens p/ nicho, status p/ funil). */
export interface DashboardJob {
  lens: string | null;
  status: string;
}

interface LensSlice {
  label: string;
  count: number;
  pct: number;
}

// Barra horizontal de proporção — o "gráfico linear nativo".
function ProportionBar({ pct, tone = "accent" }: { pct: number; tone?: "accent" | "danger" }) {
  const fill = tone === "danger" ? "bg-danger" : "bg-accent";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
      <div
        className={`h-2 rounded-full ${fill} transition-[width] duration-500 ease-out`}
        style={{ width: `${Math.max(pct, pct > 0 ? 3 : 0)}%` }}
      />
    </div>
  );
}

export function HomeDashboard({ jobs }: { jobs: DashboardJob[] }) {
  // ── Derivação em memória limpa ──────────────────────────────────────────────
  const monitored = jobs.filter((j) => j.status !== JOB_STATUS.INACTIVE);

  // Gráfico 1 — concentração por nicho (lens) sobre o universo monitorado.
  const lensCounts = monitored.reduce<Map<string, number>>((acc, j) => {
    const label = lensLabel(j.lens);
    acc.set(label, (acc.get(label) ?? 0) + 1);
    return acc;
  }, new Map());
  const lensTotal = monitored.length;
  const lensSlices: LensSlice[] = [...lensCounts.entries()]
    .map(([label, count]) => ({ label, count, pct: lensTotal ? Math.round((count / lensTotal) * 100) : 0 }))
    .sort((a, b) => b.count - a.count);

  // Gráfico 2 — funil de curadoria. Positivo = sobreviveu à curadoria humana
  // (aprovada → na esteira → aplicada). Descarte = rejeitada pelo humano.
  const countBy = (status: string) => jobs.filter((j) => j.status === status).length;
  const applied = countBy(JOB_STATUS.APPLIED);
  const inPipeline =
    countBy(JOB_STATUS.APPROVED) + countBy(JOB_STATUS.GENERATING) + countBy(JOB_STATUS.GENERATED);
  const positive = applied + inPipeline;
  const rejected = countBy(JOB_STATUS.REJECTED);
  const decided = positive + rejected;
  const approvalPct = decided ? Math.round((positive / decided) * 100) : 0;
  const rejectPct = decided ? 100 - approvalPct : 0;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* ── 1. Hero de entrada + CTA mestre (atravessa o grid) ─────────────── */}
      <section className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-surface to-surface-2 p-7 lg:col-span-3">
        {/* Glow de atmosfera (decorativo). */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-accent opacity-10 blur-3xl"
        />
        <div className="relative flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="max-w-xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-2 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Painel local · latência zero
            </span>
            <h2 className="mt-3 text-2xl font-bold leading-tight text-foreground md:text-3xl">
              Visão geral do ecossistema de vagas
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Panorama analítico do que foi coletado e curado. Mergulhe na operação para filtrar,
              ranquear e disparar candidaturas.
            </p>
          </div>

          <Link
            href="/?view=ops"
            scroll={false}
            className="group inline-flex shrink-0 items-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-background shadow-lg transition-colors hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <span aria-hidden="true">⚡</span>
            Ir para o Painel Operacional (Vagas &amp; Filtros)
            <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">
              ➔
            </span>
          </Link>
        </div>
      </section>

      {/* ── 2. Gráfico 1: concentração por nicho (lens) ───────────────────── */}
      <section className="rounded-2xl border border-border bg-surface p-6 lg:col-span-2">
        <div className="mb-5 flex items-baseline justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Concentração por nicho
          </h3>
          <span className="text-xs text-muted-foreground">{lensTotal} vaga(s) monitorada(s)</span>
        </div>

        {lensSlices.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Sem vagas monitoradas ainda — rode o coletor para popular o ecossistema.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {lensSlices.map((slice) => (
              <li key={slice.label}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium text-foreground">{slice.label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    <span className="font-semibold text-foreground">{slice.pct}%</span>
                    <span className="mx-1.5 text-border-strong">·</span>
                    {slice.count} vaga(s)
                  </span>
                </div>
                <ProportionBar pct={slice.pct} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── 3. Gráfico 2: desmembramento do funil ─────────────────────────── */}
      <section className="flex flex-col gap-4 lg:col-span-1">
        {/* Card positivo — destaque. */}
        <div className="flex-1 rounded-2xl border border-accent-strong bg-surface p-6">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Aproveitadas
            </h3>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-accent">
              {approvalPct}%
            </span>
          </div>
          <p className="mt-2 text-4xl font-bold tabular-nums text-foreground">{positive}</p>
          <p className="mb-3 mt-1 text-xs text-muted-foreground">
            {applied} aplicada(s) · {inPipeline} na esteira
          </p>
          <ProportionBar pct={approvalPct} tone="accent" />
        </div>

        {/* Card de descarte — rebaixado (border-danger + texto muted). */}
        <div className="flex-1 rounded-2xl border border-danger bg-surface p-6">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Descartadas
            </h3>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted-foreground">
              {rejectPct}%
            </span>
          </div>
          <p className="mt-2 text-4xl font-bold tabular-nums text-muted-foreground">{rejected}</p>
          <p className="mb-3 mt-1 text-xs text-muted-foreground">rejeitadas na curadoria</p>
          <ProportionBar pct={rejectPct} tone="danger" />
        </div>
      </section>
    </div>
  );
}
