"use server";

import { mkdir, writeFile } from "fs/promises";
import { dirname } from "path";
import { revalidatePath } from "next/cache";
import { prisma } from "@/db/prisma";
import { JOB_STATUS } from "./status";
import { generateCoverLetter, buildArtifact, type CoverLetterInput } from "@/core/generator";
import { judgeWithLlm } from "@/core/llm-judge";
import { hashSourceId } from "@/core/utils";

/**
 * Resultado padrão de toda Server Action: união discriminada.
 * O cliente faz narrowing por `res.ok` sem adivinhar o shape.
 */
export type ActionResult = { ok: true } | { ok: false; error: string };

/** Variante que carrega dados no sucesso. Mesmo narrowing por `res.ok`. */
export type DataResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Payload de `revalidateJob`: o veredito do LLM (fresco ou recuperado do cache). */
export interface RevalidateResult {
  jobId: string;
  score: number;
  lens: string;
  reasoning: string;
  fromCache: boolean;
}

/** Edição manual de ranking vinda da curadoria. */
export interface RankingPatch {
  score: number | null;
  lens: string | null;
}

function badId(id: unknown): id is string {
  return typeof id !== "string" || id.trim() === "";
}

/** Rejeita a vaga: status → REJECTED. */
export async function rejectJob(id: string): Promise<ActionResult> {
  if (badId(id)) return { ok: false, error: "id inválido" };
  try {
    await prisma.job.update({
      where: { id },
      data: { status: JOB_STATUS.REJECTED },
    });
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "falha ao rejeitar" };
  }
}

/** Edita score/lens manualmente. Valida no servidor — nunca confia no cliente. */
export async function updateJobRanking(id: string, patch: RankingPatch): Promise<ActionResult> {
  if (badId(id)) return { ok: false, error: "id inválido" };

  const { score, lens } = patch;
  if (score !== null && (typeof score !== "number" || !Number.isFinite(score))) {
    return { ok: false, error: "score deve ser número finito ou vazio" };
  }
  if (lens !== null && typeof lens !== "string") {
    return { ok: false, error: "lens deve ser texto ou vazio" };
  }

  try {
    await prisma.job.update({
      where: { id },
      data: { score, lens: lens && lens.trim() !== "" ? lens.trim() : null },
    });
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "falha ao atualizar ranking" };
  }
}

/**
 * Gera a carta de apresentação via Ollama local e grava em disco.
 * Fluxo: GENERATING (in-flight) → GENERATED (carta no disco, aguarda revisão).
 * Sem scraping: usa só o contexto persistido no Prisma (fallback se faltar descrição).
 */
export async function triggerGeneration(id: string): Promise<ActionResult> {
  if (badId(id)) return { ok: false, error: "id inválido" };

  const job = await prisma.job.findUnique({
    where: { id },
    select: {
      id: true, status: true, company: true, title: true, lens: true,
      description: true, applyUrl: true, sourceId: true, score: true,
    },
  });
  if (!job) return { ok: false, error: "vaga não encontrada" };

  // ── Guarda de estado: não regerar carta para vaga em status terminal ──────
  // Terminais: APPLIED (enviada) e REJECTED (descartada) — decisão fechada.
  if (job.status === JOB_STATUS.APPLIED || job.status === JOB_STATUS.REJECTED) {
    return { ok: false, error: `Vaga já está em status final (${job.status}). Geração não permitida.` };
  }
  // Já há uma geração em andamento — evita disparo duplicado concorrente.
  if (job.status === JOB_STATUS.GENERATING) {
    return { ok: false, error: "Geração já está em andamento." };
  }
  console.log(`[gerar-candidatura] iniciando geração (job=${id}, status atual=${job.status})`);

  // Marca in-flight para o painel refletir que a geração começou.
  await prisma.job.update({ where: { id }, data: { status: JOB_STATUS.GENERATING } });
  revalidatePath("/");

  const input: CoverLetterInput = {
    company: job.company,
    title: job.title,
    lens: job.lens,
    description: job.description,
    applyUrl: job.applyUrl,
    sourceId: job.sourceId,
    score: job.score,
  };

  try {
    const body = await generateCoverLetter(input);
    if (!body) {
      // Ollama offline / resposta vazia → reverte para APPROVED (segue revisável na fila).
      await prisma.job.update({ where: { id }, data: { status: JOB_STATUS.APPROVED } });
      revalidatePath("/");
      return { ok: false, error: "Ollama indisponível ou resposta vazia. Status revertido para APPROVED." };
    }

    const artifact = buildArtifact(input, body);
    await mkdir(dirname(artifact.filename), { recursive: true });
    await writeFile(artifact.filename, artifact.content, "utf-8");
    console.log(`[gerar-candidatura] carta gravada: ${artifact.filename} (job=${job.id} @ ${job.company})`);

    await prisma.job.update({ where: { id }, data: { status: JOB_STATUS.GENERATED } });
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    await prisma.job.update({ where: { id }, data: { status: JOB_STATUS.APPROVED } });
    revalidatePath("/");
    return { ok: false, error: e instanceof Error ? e.message : "falha ao gerar candidatura" };
  }
}

/** Confirma o envio: GENERATED → APPLIED. Gate de revisão humana. */
export async function markApplied(id: string): Promise<ActionResult> {
  if (badId(id)) return { ok: false, error: "id inválido" };
  try {
    const job = await prisma.job.findUnique({ where: { id }, select: { status: true } });
    if (!job) return { ok: false, error: "vaga não encontrada" };
    if (job.status !== JOB_STATUS.GENERATED) {
      return { ok: false, error: `transição inválida: ${job.status} → APPLIED (esperado GENERATED)` };
    }
    await prisma.job.update({ where: { id }, data: { status: JOB_STATUS.APPLIED } });
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "falha ao marcar como aplicada" };
  }
}

/**
 * Marca a vaga como aplicada direto da fila (ACTIVE/APPROVED/null → APPLIED),
 * sem passar pela geração de carta. Distinto de `markApplied`, que é o gate
 * GENERATED → APPLIED do histórico. Bloqueia só estados já finalizados.
 */
export async function applyJob(id: string): Promise<ActionResult> {
  if (badId(id)) return { ok: false, error: "id inválido" };
  try {
    const job = await prisma.job.findUnique({ where: { id }, select: { status: true } });
    if (!job) return { ok: false, error: "vaga não encontrada" };
    if (job.status === JOB_STATUS.APPLIED || job.status === JOB_STATUS.REJECTED) {
      return { ok: false, error: `vaga já processada (${job.status})` };
    }
    await prisma.job.update({ where: { id }, data: { status: JOB_STATUS.APPLIED } });
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "falha ao marcar como aplicada" };
  }
}

/**
 * Cache em memória das reavaliações manuais. Chave = hash(title|company|
 * combinedDescription); valor = veredito. Vive enquanto o processo do servidor
 * Next viver — reinício/redeploy limpa (aceitável: 1ª chamada pós-restart
 * re-infere). NÃO altera o schema. Distinto do cache do pipeline (engine.ts,
 * por canonicalHash), que serve à coleta automática.
 */
const revalidateCache = new Map<string, { score: number; lens: string; reasoning: string }>();

/** Teto do cache em memória — evita crescimento ilimitado de RAM (eviction FIFO). */
const MAX_CACHE_SIZE = 500;

/**
 * Força reavaliação de uma vaga pelo LLM local (Qwen3) com contexto extra colado
 * pelo humano. Não mexe no `status` (curadoria) — só score/lens/reasoning.
 * Cache inteligente: mesmo input (título+empresa+texto) → resultado instantâneo.
 */
export async function revalidateJob(
  id: string,
  additionalText?: string,
): Promise<DataResult<RevalidateResult>> {
  if (badId(id)) return { ok: false, error: "id inválido" };

  const job = await prisma.job.findUnique({
    where: { id },
    select: { id: true, title: true, company: true, description: true },
  });
  if (!job) return { ok: false, error: "Vaga não encontrada." };
  // title é obrigatório (sem ele o LLM não tem o que julgar). description é
  // opcional: adapters de e-mail gravam null — daí o texto colado pelo humano.
  if (!job.title) {
    return { ok: false, error: "Vaga não pode ser reavaliada — dados insuficientes." };
  }

  // Combina o anúncio original (se houver) + o texto colado (se ≥20 chars).
  const parts: string[] = [];
  if (job.description?.trim()) parts.push(`Descrição original: ${job.description.trim()}`);
  const extra = additionalText?.trim() ?? "";
  if (extra.length >= 20) parts.push(`Informações adicionais: ${extra}`);
  const combinedDescription = parts.join("\n\n");

  const cacheKey = hashSourceId(job.title, job.company, combinedDescription);
  const cached = revalidateCache.get(cacheKey);
  if (cached) {
    // Cache hit: sem inferência. Persiste mesmo assim (idempotente) e refresca.
    await prisma.job.update({ where: { id }, data: cached });
    revalidatePath("/");
    return { ok: true, data: { jobId: id, ...cached, fromCache: true } };
  }

  try {
    const verdict = await judgeWithLlm(job.title, job.company, combinedDescription);
    if (!verdict) {
      // judgeWithLlm engole offline/timeout/JSON inválido e retorna null.
      return { ok: false, error: "Ollama indisponível ou muito lento. Tente novamente." };
    }

    const value = { score: verdict.score, lens: verdict.lens, reasoning: verdict.reasoning };
    await prisma.job.update({ where: { id }, data: value });
    revalidateCache.set(cacheKey, value);
    // Despeja a entrada mais antiga (1ª chave de inserção) ao estourar o teto.
    if (revalidateCache.size > MAX_CACHE_SIZE) {
      const oldest = revalidateCache.keys().next().value;
      if (oldest !== undefined) revalidateCache.delete(oldest);
    }
    revalidatePath("/");
    return { ok: true, data: { jobId: id, ...value, fromCache: false } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao reavaliar." };
  }
}
