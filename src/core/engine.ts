import { Prisma } from "@prisma/client";
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
  // Fontes que responderam com sucesso nesta run. Alimenta o fail-safe do
  // soft-delete: só expiramos vagas de fontes que comprovadamente responderam.
  const seenSources = new Set<string>();
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
        for (const job of r.value) seenSources.add(job.source);
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

  // ── Pré-carregamento em memória (mapa mestre) — mata o N+1 ────────────────
  // UMA findMany substitui os 2 SELECTs por vaga (cache por hash + status humano).
  // Chaves buscadas: composta (source:sourceId) de toda vaga + canonicalHash das
  // vagas válidas. PrismaPromise dos upserts ficam num buffer (flush em lote).
  type ExistingRow = {
    source: string;
    sourceId: string;
    status: string;
    canonicalHash: string | null;
    score: number | null;
    lens: string | null;
    reasoning: string | null;
  };

  const hashes = [
    ...new Set(
      deduplicated.filter((j) => j.title && j.company).map((j) => canonicalHash(j.company, j.title)),
    ),
  ];
  const orConds: Prisma.JobWhereInput[] = deduplicated.map((j) => ({
    source: j.source,
    sourceId: j.sourceId,
  }));
  if (hashes.length) orConds.push({ canonicalHash: { in: hashes } });

  const existingRows: ExistingRow[] = orConds.length
    ? await prisma.job.findMany({
        where: { OR: orConds },
        select: {
          source: true, sourceId: true, status: true,
          canonicalHash: true, score: true, lens: true, reasoning: true,
        },
      })
    : [];

  // Mapa por chave composta: estado atual da vaga (inclui status humano).
  const existingByKey = new Map<string, ExistingRow>(
    existingRows.map((r) => [`${r.source}:${r.sourceId}`, r] as const),
  );
  // Mapa por canonicalHash: veredito reaproveitável. Espelha o filtro do antigo
  // findFirst (score+reasoning != null); primeira linha qualificada vence.
  const existingByHash = new Map<string, ExistingRow>();
  for (const r of existingRows) {
    if (r.canonicalHash && r.score !== null && r.reasoning !== null && !existingByHash.has(r.canonicalHash)) {
      existingByHash.set(r.canonicalHash, r);
    }
  }

  // Buffer de escrita: PrismaPromise inertes até o flush transacional pós-loop.
  const writeBuffer: Prisma.PrismaPromise<unknown>[] = [];

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
    // Cache por canonicalHash agora sai do mapa em memória (zero query).
    const cached = existingByHash.get(hash);

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
    // Status humano agora sai do mapa em memória (zero query).
    const existing = existingByKey.get(`${job.source}:${job.sourceId}`);
    const nextStatus =
      existing && (HUMAN_OWNED_STATUSES as readonly string[]).includes(existing.status)
        ? existing.status // mantém a decisão humana intacta
        : "ACTIVE"; // vaga nova, já ACTIVE, ou INACTIVE → (re)ativa

    // Upsert NÃO dispara aqui: vai pro buffer (PrismaPromise inerte) p/ flush em lote.
    console.log(`💾 Enfileirando vaga: "${job.title}" @ ${job.company}`);
    writeBuffer.push(prisma.job.upsert({
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
    }));

    // Espelha o estado escrito nos mapas → próxima vaga do loop vê na hora
    // (vaga-irmã com mesmo hash dá cache hit sem re-chamar o LLM, como antes).
    const writtenRow: ExistingRow = {
      source: job.source,
      sourceId: job.sourceId,
      status: existing ? nextStatus : "ACTIVE",
      canonicalHash: hash,
      score: finalScore,
      lens: finalLens,
      reasoning: finalReasoning,
    };
    existingByKey.set(`${job.source}:${job.sourceId}`, writtenRow);
    if (finalReasoning !== null && finalScore !== null && !existingByHash.has(hash)) {
      existingByHash.set(hash, writtenRow);
    }
  }

  // ── Flush transacional em lotes de 50 (protege o single-writer do SQLite) ─
  // PrismaPromise são inertes até aqui; $transaction roda cada lote atômico.
  // Lotes de 50 evitam estourar o teto de variáveis por query do SQLite.
  async function flushWrites(): Promise<void> {
    const CHUNK = 50;
    for (let i = 0; i < writeBuffer.length; i += CHUNK) {
      await prisma.$transaction(writeBuffer.slice(i, i + CHUNK));
    }
  }
  await flushWrites();

  // ── Soft-delete: vagas não vistas nesta run → INACTIVE ──────────────────
  // Fail-safe: Apenas aplicamos soft-delete em vagas antigas de fontes que responderam com sucesso na rodada atual. Vagas de fontes que falharam ou deram timeout são preservadas.
  const expired = await prisma.job.updateMany({
    where: {
      lastSeenAt: { lt: runStartTime },
      status: "ACTIVE",
      source: { in: Array.from(seenSources) },
    },
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
