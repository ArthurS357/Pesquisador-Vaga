/**
 * Harness de avaliação do juiz LLM (esqueleto).
 * Uso: npm run eval:judge
 *
 * Roda o `judgeWithLlm` sobre um golden set fixo e mede desvio de score (MAE),
 * acurácia de decisão e acurácia de lens. Mirror do caminho de produção: a
 * descrição passa pelo `sanitizeJobDescription` (borda de ingestão) antes do juiz.
 *
 * Sem Ollama no ar, cada item cai em OFFLINE (judge → null) e sai das métricas —
 * a estrutura roda mesmo assim. Popule `golden-set.json` para ampliar a cobertura.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";
import { judgeWithLlm } from "../core/llm-judge";
import { sanitizeJobDescription } from "../core/sanitizer";
import { OLLAMA_MODEL } from "../core/ollama";

dotenv.config();

/** Score >= este limiar ⇒ decisão "apply" (espelha 50-74 = moderate fit no juiz). */
const APPLY_THRESHOLD = 50;

type Decision = "apply" | "skip";

interface GoldenItem {
  id: string;
  title: string;
  company: string;
  description: string;
  expectedScore: number;
  expectedDecision: Decision;
  expectedLens: string;
}

interface EvalRow {
  id: string;
  offline: boolean;
  actualScore: number | null;
  actualDecision: Decision | null;
  actualLens: string | null;
  expectedScore: number;
  expectedDecision: Decision;
  expectedLens: string;
}

function decisionFor(score: number): Decision {
  return score >= APPLY_THRESHOLD ? "apply" : "skip";
}

function loadGoldenSet(): GoldenItem[] {
  const path = fileURLToPath(new URL("./golden-set.json", import.meta.url));
  const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
  if (!Array.isArray(parsed)) throw new Error("golden-set.json deve ser um array");
  return parsed as GoldenItem[];
}

async function main(): Promise<void> {
  const golden = loadGoldenSet();
  console.log(`\n[eval] Golden set: ${golden.length} exemplo(s) · modelo ${OLLAMA_MODEL}\n`);

  const rows: EvalRow[] = [];
  for (const item of golden) {
    const fenced = sanitizeJobDescription(item.description);
    const result = await judgeWithLlm(item.title, item.company, fenced);
    rows.push({
      id: item.id,
      offline: result === null,
      actualScore: result?.score ?? null,
      actualDecision: result ? decisionFor(result.score) : null,
      actualLens: result?.lens ?? null,
      expectedScore: item.expectedScore,
      expectedDecision: item.expectedDecision,
      expectedLens: item.expectedLens,
    });
  }

  console.table(
    rows.map((r) => ({
      id: r.id,
      exp_score: r.expectedScore,
      got_score: r.offline ? "OFFLINE" : r.actualScore,
      decision: r.offline ? "—" : `${r.actualDecision}${r.actualDecision === r.expectedDecision ? " ✓" : " ✗"}`,
      lens: r.offline ? "—" : `${r.actualLens}${r.actualLens === r.expectedLens ? " ✓" : " ✗"}`,
    })),
  );

  const judged = rows.filter((r) => !r.offline);
  if (judged.length === 0) {
    console.warn("\n[eval] ⚠️ Nenhum item avaliado (Ollama offline). Estrutura OK; suba o Ollama para métricas reais.\n");
    return;
  }

  const mae =
    judged.reduce((sum, r) => sum + Math.abs((r.actualScore ?? 0) - r.expectedScore), 0) / judged.length;
  const decHits = judged.filter((r) => r.actualDecision === r.expectedDecision).length;
  const lensHits = judged.filter((r) => r.actualLens === r.expectedLens).length;

  console.log("\n[eval] Métricas (sobre itens avaliados):");
  console.log(`  Avaliados:          ${judged.length}/${rows.length}`);
  console.log(`  MAE de score:       ${mae.toFixed(1)}`);
  console.log(`  Acurácia decisão:   ${((decHits / judged.length) * 100).toFixed(0)}% (${decHits}/${judged.length})`);
  console.log(`  Acurácia lens:      ${((lensHits / judged.length) * 100).toFixed(0)}% (${lensHits}/${judged.length})\n`);
}

main().catch((err) => {
  console.error("[eval] Erro fatal:", err);
  process.exitCode = 1;
});
