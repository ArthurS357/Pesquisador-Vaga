/**
 * db-clean.ts — Script CLI de limpeza do banco de vagas.
 * A lógica de filtros/remoção vive em src/core/db-clean-core.ts.
 *
 * Uso:
 *   npm run db:clean                         # dry run (padrão)
 *   npm run db:clean -- --blocked            # só inativas (INACTIVE)
 *   npm run db:clean -- --low-score          # score <= 20 ou null
 *   npm run db:clean -- --source greenhouse-stripe
 *   npm run db:clean -- --older-than 30      # lastSeenAt > 30 dias atrás
 *   npm run db:clean -- --all                # todos os critérios
 *   npm run db:clean -- --all --execute      # remove após confirmação
 */

import { createInterface } from "readline";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import {
  getCleanupCounts,
  executeCleanup,
  HUMAN_OWNED_STATUSES,
  type CleanupFilters,
} from "./core/db-clean-core";

dotenv.config();

const prisma = new PrismaClient();

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface Args extends CleanupFilters {
  execute: boolean;
}

// ── Parse de argumentos ───────────────────────────────────────────────────────

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const has = (flag: string) => argv.includes(flag);
  const get = (flag: string): string | null => {
    const idx = argv.indexOf(flag);
    return idx !== -1 && argv[idx + 1] ? (argv[idx + 1] ?? null) : null;
  };

  const olderThanStr = get("--older-than");
  const olderThan = olderThanStr !== null ? parseInt(olderThanStr, 10) : undefined;

  if (olderThan !== undefined && isNaN(olderThan)) {
    console.error("❌ --older-than requer um número inteiro de dias. Ex: --older-than 30");
    process.exit(1);
  }

  const sourceArg = get("--source");
  return {
    blocked: has("--blocked") || undefined,
    lowScore: has("--low-score") || undefined,
    source: sourceArg ?? undefined,
    olderThan,
    all: has("--all") || undefined,
    execute: has("--execute"),
  };
}

// ── Confirmação interativa ────────────────────────────────────────────────────

async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "s");
    });
  });
}

// ── Tabela de resumo ──────────────────────────────────────────────────────────

const SEP = "─".repeat(52);

function printCounts(
  counts: Awaited<ReturnType<typeof getCleanupCounts>>,
  dryRun: boolean
): void {
  console.log(`\n🧹 db:clean — ${dryRun ? "Dry Run (use --execute para remover)" : "Removendo..."}\n`);
  console.log(`${"Critério".padEnd(38)} ${"Vagas".padStart(6)}`);
  console.log(SEP);
  for (const c of counts.criteria) {
    console.log(`${c.label.padEnd(38)} ${String(c.count).padStart(6)}`);
  }
  console.log(SEP);
  console.log(`${"Total (deduplicado)".padEnd(38)} ${String(counts.total).padStart(6)}\n`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { execute, ...filters } = parseArgs();

  const hasAnyCriteria =
    !!(filters.blocked || filters.lowScore || filters.source !== undefined || filters.olderThan !== undefined || filters.all);

  if (!hasAnyCriteria) {
    console.log(`
🧹 db:clean — Nenhum critério selecionado.

Uso:
  npm run db:clean -- --blocked            Vagas INACTIVE (soft-deleted)
  npm run db:clean -- --low-score          Score ≤20 ou não avaliadas
  npm run db:clean -- --source <nome>      Fonte específica (ex: greenhouse-stripe)
  npm run db:clean -- --older-than <dias>  Não vistas há mais de N dias
  npm run db:clean -- --all                Todos os critérios acima
  npm run db:clean -- [critérios] --execute  Remove (pede confirmação)
`);
    await prisma.$disconnect();
    return;
  }

  const counts = await getCleanupCounts(prisma, filters);

  printCounts(counts, !execute);

  if (counts.skipped > 0) {
    console.log(`⚠️  ${counts.skipped} vaga(s) ignoradas (status com decisão humana: ${HUMAN_OWNED_STATUSES.join(", ")})\n`);
  }

  if (counts.total === 0) {
    console.log("✅ Nenhuma vaga elegível para remoção.");
    await prisma.$disconnect();
    return;
  }

  if (!execute) {
    console.log("Nenhuma vaga removida. Use --execute para confirmar.");
    await prisma.$disconnect();
    return;
  }

  const ok = await confirm(
    `Tem certeza? ${counts.total} vaga(s) serão removidas permanentemente. (s/N): `
  );

  if (!ok) {
    console.log("\n❌ Operação cancelada.");
    await prisma.$disconnect();
    return;
  }

  const result = await executeCleanup(prisma, filters);

  console.log("");
  for (const c of result.criteria) {
    if (c.count === 0) {
      console.log(`  ↷ ${c.label}: 0 (já removidas por outro critério)`);
    } else {
      console.log(`  ✅ ${c.count} removidas — ${c.label}`);
    }
  }

  console.log(`\n${SEP}`);
  console.log(`🎉 ${result.total} vaga(s) removidas do banco.\n`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("❌ Erro fatal no db:clean:", msg);
  await prisma.$disconnect();
  process.exitCode = 1;
});
