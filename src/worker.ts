import * as cron from "node-cron";
import * as dotenv from "dotenv";
import { runCollect } from "./index";
import { prisma } from "./db/prisma";
import { purgeInactiveJobs, PURGE_INACTIVE_DAYS_DEFAULT } from "./core/purge";

dotenv.config();

const CRON_SCHEDULE = process.env.COLLECT_CRON ?? "0 6 * * *"; // 06:00 diariamente
const PURGE_SCHEDULE = process.env.PURGE_SCHEDULE ?? "0 4 * * 0"; // 04:00 domingo (semanal)
const PURGE_INACTIVE_DAYS = Number(process.env.PURGE_INACTIVE_DAYS ?? PURGE_INACTIVE_DAYS_DEFAULT);

console.log(`[Worker] Iniciado em ${new Date().toISOString()}`);
console.log(`[Worker] Coleta agendada: "${CRON_SCHEDULE}" (TZ local do sistema)`);
console.log(`[Worker] Purge agendado:  "${PURGE_SCHEDULE}" (INACTIVE > ${PURGE_INACTIVE_DAYS}d)\n`);

// Execução imediata no startup para validar o pipeline (descomente se desejar)
// runCollect().catch((e) => console.error("[Worker] Erro no startup:", e));

cron.schedule(CRON_SCHEDULE, async () => {
  console.log(`\n[Worker] ⚡ Cron de coleta disparado em ${new Date().toISOString()}`);
  try {
    await runCollect();
    console.log(`[Worker] ✓ Coleta finalizada em ${new Date().toISOString()}\n`);
  } catch (err) {
    // Capturado aqui como última linha de defesa — runCollect já captura internamente
    console.error(`[Worker] ✗ Erro inesperado no cron:`, err);
  }
});

// Purge agendado: hard-delete de vagas INACTIVE antigas. Status humanos
// (REJECTED/APPROVED/GENERATING/GENERATED/APPLIED) são intocados pela própria
// purgeInactiveJobs. Log com contagem + IDs para auditoria.
cron.schedule(PURGE_SCHEDULE, async () => {
  console.log(`\n[Worker] 🧹 Cron de purge disparado em ${new Date().toISOString()}`);
  try {
    const r = await purgeInactiveJobs(prisma, PURGE_INACTIVE_DAYS);
    console.log(
      `[Worker] ✓ Purge: ${r.removed} vaga(s) INACTIVE removida(s) ` +
        `(não vistas há >${r.days}d, cutoff ${r.cutoff.toISOString()})`,
    );
    if (r.removed > 0) console.log(`[Worker]   IDs removidos: ${r.ids.join(", ")}`);
  } catch (err) {
    console.error(`[Worker] ✗ Erro inesperado no purge:`, err);
  }
});

// Manter o processo vivo
process.on("SIGINT", () => {
  console.log("\n[Worker] Encerrando (SIGINT)...");
  process.exit(0);
});
process.on("SIGTERM", () => {
  console.log("\n[Worker] Encerrando (SIGTERM)...");
  process.exit(0);
});
