import { JobAdapter, Job } from "./types";
import { canonicalHash } from "./utils";
import { rankJob } from "./ranker";
import { judgeWithLlm } from "./llm-judge";
import { HUMAN_OWNED_STATUSES } from "./db-clean-core";
import { prisma } from "../db/prisma";

export async function collect(adapters: JobAdapter[], concurrency = 3): Promise<Job[]> {
  const runStartTime = new Date();
  const all: Job[] = [];

  // ── Janela incremental para adapters baseados em e-mail ───────────────────
  // Ponto de partida do IMAP SINCE = data do e-mail mais recente já persistido.
  // Adapters de API (Greenhouse/Lever/Ashby) ignoram ctx.since.
  const lastEmail = await prisma.job.findFirst({
    where: { source: { contains: "email" } },
    orderBy: { updatedAt: "desc" },
    select: { updatedAt: true },
  });

  // Piso de sobreposição: nunca confiar num `since` mais recente que
  // LOOKBACK_FLOOR_DAYS atrás. Garante re-scan de remetentes esparsos (InfoJobs
  // manda poucos e-mails/dia → janela fina os perdia) e neutraliza header `Date`
  // futuro/errado, que empurraria o SINCE adiante. O dedupe por source:sourceId
  // + upsert absorve a sobreposição (custo: re-parse de e-mails já vistos).
  const LOOKBACK_FLOOR_DAYS = 14;
  const floor = new Date(Date.now() - LOOKBACK_FLOOR_DAYS * 86_400_000);
  const lastSeen = lastEmail?.updatedAt ?? null;
  const since = lastSeen && lastSeen < floor ? lastSeen : floor;
  const ctx = { since };

  // ── Coleta em chunks (controle de concorrência) ──────────────────────────
  for (let i = 0; i < adapters.length; i += concurrency) {
    const chunk = adapters.slice(i, i + concurrency);
    const results = await Promise.allSettled(chunk.map((a) => a.fetchJobs(ctx)));
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      const adapter = chunk[j];
      if (!r || !adapter) continue; // j < results.length: nunca undefined em runtime; narrowing p/ o compilador
      if (r.status === "fulfilled") {
        console.log(`📥 Adapter "${adapter.name}" retornou ${r.value.length} vaga(s)`);
        all.push(...r.value);
      } else {
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
        console.error(`  ! adapter falhou [${adapter.name}]:`, msg);
      }
    }
  }

  // ── Dedupe em memória por source:sourceId (mesma run) ────────────────────
  const seen = new Set<string>();
  const deduplicated = all.filter((j) => {
    const key = `${j.source}:${j.sourceId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  let countBlocked = 0;
  let countLowRelevance = 0;
  let countCacheHit = 0;
  let countLlmJudged = 0;

  // ── Pipeline de avaliação e persistência ─────────────────────────────────
  for (const job of deduplicated) {
    if (!job.title || !job.company) {
      console.warn('⚠️ Vaga inválida (sem título ou empresa):', job);
      continue;
    }

    const hash = canonicalHash(job.company, job.title);

    // Estágio 1: Heurística local
    const heuristic = rankJob(job);

    if (!heuristic.needsLlm) {
      if (heuristic.blockReason) {
        countBlocked++;
        console.info(`  ⬛ [BLOQUEADO] "${job.title}" @ ${job.company} (motivo: ${heuristic.blockReason})`);
      } else {
        countLowRelevance++;
        console.info(`  ⬇ [LOW_RELEVANCE] "${job.title}" @ ${job.company} (score=${heuristic.score})`);
      }
      continue;
    }

    // Verificar cache por canonicalHash (vaga já avaliada em run anterior?)
    // Exige `reasoning != null`: só veredito do LLM (ou revalidação humana) gera
    // reasoning. Scores de FALLBACK heurístico (Ollama offline) ficam com
    // reasoning null e NÃO entram no cache — senão, uma run com Ollama fora
    // "envenenaria" o hash e barraria o julgamento LLM de vagas irmãs quando o
    // Ollama voltasse.
    const cached = await prisma.job.findFirst({
      where: { canonicalHash: hash, score: { not: null }, reasoning: { not: null } },
      select: { score: true, lens: true, reasoning: true },
    });

    let finalScore = heuristic.score;
    let finalLens = heuristic.lens;
    // Justificativa do LLM (Estágio 2). Heurística pura não gera reasoning.
    let finalReasoning: string | null = null;

    if (cached?.score !== null && cached?.score !== undefined) {
      // Estágio 2 skip: usa score em cache
      finalScore = cached.score;
      finalLens = cached.lens ?? heuristic.lens;
      finalReasoning = cached.reasoning ?? null;
      countCacheHit++;
      console.info(`  ✦ [CACHE] "${job.title}" @ ${job.company} (score=${finalScore}, lens=${finalLens})`);
    } else {
      // Estágio 2: LLM Judge via Ollama
      console.info(`  → [LLM] Avaliando "${job.title}" @ ${job.company}...`);
      const llmResult = await judgeWithLlm(
        job.title,
        job.company,
        job.description ?? ""
      );

      if (llmResult) {
        finalScore = llmResult.score;
        finalLens = llmResult.lens;
        finalReasoning = llmResult.reasoning;
        countLlmJudged++;
        console.info(`  ✓ [LLM] score=${finalScore}, lens=${finalLens} — ${llmResult.reasoning}`);
      } else {
        // Ollama offline ou JSON inválido → usa heurística como fallback
        console.info(`  ↩ [FALLBACK] "${job.title}" — usando score heurístico ${finalScore}`);
      }
    }

    // ── Preserva decisão de curadoria humana ────────────────────────────────
    // Regra: o motor só altera status para ACTIVE se a vaga for nova ou estiver
    // INACTIVE (ressurreição). Se o humano já classificou (APPROVED/REJECTED/
    // GENERATING/APPLIED), o motor NÃO tem autoridade para sobrescrever.
    const existing = await prisma.job.findUnique({
      where: { source_sourceId: { source: job.source, sourceId: job.sourceId } },
      select: { status: true },
    });
    const nextStatus =
      existing && (HUMAN_OWNED_STATUSES as readonly string[]).includes(existing.status)
        ? existing.status // mantém a decisão humana intacta
        : "ACTIVE"; // vaga nova, já ACTIVE, ou INACTIVE → (re)ativa

    // Upsert no Prisma com campos completos
    console.log(`💾 Salvando vaga: "${job.title}" @ ${job.company}`);
    await prisma.job.upsert({
      where: { source_sourceId: { source: job.source, sourceId: job.sourceId } },
      update: {
        title: job.title,
        location: job.location,
        description: job.description,
        applyUrl: job.applyUrl,
        updatedAt: job.updatedAt,
        lastSeenAt: runStartTime,
        status: nextStatus,
        canonicalHash: hash,
        score: finalScore,
        lens: finalLens,
        reasoning: finalReasoning,
      },
      create: {
        source: job.source,
        sourceId: job.sourceId,
        company: job.company,
        title: job.title,
        location: job.location,
        description: job.description,
        applyUrl: job.applyUrl,
        updatedAt: job.updatedAt,
        lastSeenAt: runStartTime,
        status: "ACTIVE",
        canonicalHash: hash,
        score: finalScore,
        lens: finalLens,
        reasoning: finalReasoning,
      },
    });
  }

  // ── Soft-delete: vagas não vistas nesta run → INACTIVE ──────────────────
  const expired = await prisma.job.updateMany({
    where: { lastSeenAt: { lt: runStartTime }, status: "ACTIVE" },
    data: { status: "INACTIVE" },
  });

  // ── Resumo da run ────────────────────────────────────────────────────────
  console.info(`\n── Resumo da Run ──────────────────────────────────────`);
  console.info(`  Total coletadas:     ${deduplicated.length}`);
  console.info(`  Bloqueadas (role):   ${countBlocked}`);
  console.info(`  LOW_RELEVANCE (skip):${countLowRelevance}`);
  console.info(`  Score em cache:      ${countCacheHit}`);
  console.info(`  Avaliadas pelo LLM:  ${countLlmJudged}`);
  console.info(`  INACTIVE (expiradas):${expired.count}`);
  console.info(`────────────────────────────────────────────────────────\n`);

  return deduplicated;
}
