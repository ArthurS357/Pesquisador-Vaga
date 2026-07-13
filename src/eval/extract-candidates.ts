/**
 * Extrai vagas reais do banco como candidatas a golden set do eval do juiz.
 * Uso: npm run extract-candidates [-- --relaxed]
 *
 * Padrão (espírito do gate de regressão): status GENERATED/APPROVED com score e
 * reasoning preenchidos — vagas que passaram por veredito LLM + curadoria humana.
 *
 * --relaxed: inclui também REJECTED/APPLIED/ACTIVE e dispensa reasoning. Útil em
 * banco jovem (sem GENERATED/APPROVED ainda): entrega matéria-prima real para a
 * curadoria manual definir os `expected*` — os scores heurísticos existentes NÃO
 * são ground truth, são só ponto de partida.
 *
 * Saída: src/eval/candidates.json — campos compatíveis com golden-set.json
 * (expected* pré-preenchidos com os valores atuais) + contexto de curadoria
 * (status, judgeSource, reasoning atual).
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";
import { prisma } from "../db/prisma";

dotenv.config();

/** Espelha o APPLY_THRESHOLD do eval-judge: score >= 50 ⇒ "apply". */
const APPLY_THRESHOLD = 50;
const DESCRIPTION_CHARS = 500;

interface CandidateItem {
  id: string;
  title: string;
  company: string;
  description: string;
  expectedScore: number;
  expectedDecision: "apply" | "skip";
  expectedLens: string;
  // Contexto de curadoria (ignorado pelo harness; ajuda a revisar os expected*):
  status: string;
  judgeSource: string | null;
  currentReasoning: string | null;
}

async function main(): Promise<void> {
  const relaxed = process.argv.includes("--relaxed");
  const statuses = relaxed
    ? ["GENERATED", "APPROVED", "APPLIED", "REJECTED", "ACTIVE"]
    : ["GENERATED", "APPROVED"];

  const jobs = await prisma.job.findMany({
    where: {
      status: { in: statuses },
      score: { not: null },
      ...(relaxed ? {} : { reasoning: { not: null } }),
    },
    orderBy: { score: "desc" },
  });

  const candidates: CandidateItem[] = jobs.map((job) => {
    const score = job.score ?? 0;
    return {
      id: `db-${job.id}`,
      title: job.title,
      company: job.company,
      description: (job.description ?? "").slice(0, DESCRIPTION_CHARS),
      expectedScore: score,
      expectedDecision: score >= APPLY_THRESHOLD ? "apply" : "skip",
      expectedLens: job.lens ?? "generic",
      status: job.status,
      judgeSource: job.judgeSource,
      currentReasoning: job.reasoning,
    };
  });

  const outPath = fileURLToPath(new URL("./candidates.json", import.meta.url));
  writeFileSync(outPath, JSON.stringify(candidates, null, 2) + "\n", "utf-8");
  console.log(
    `[extract] ${candidates.length} candidato(s) (${relaxed ? "relaxed" : "estrito"}: ${statuses.join(", ")}) → ${outPath}`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[extract] Erro fatal:", err);
  process.exitCode = 1;
});
