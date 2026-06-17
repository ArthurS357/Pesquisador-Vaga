"use server";

import { mkdir, writeFile } from "fs/promises";
import { dirname } from "path";
import { revalidatePath } from "next/cache";
import { prisma } from "@/db/prisma";
import { JOB_STATUS } from "./status";
import { generateCoverLetter, buildArtifact, type CoverLetterInput } from "@/core/generator";

/**
 * Resultado padrão de toda Server Action: união discriminada.
 * O cliente faz narrowing por `res.ok` sem adivinhar o shape.
 */
export type ActionResult = { ok: true } | { ok: false; error: string };

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
