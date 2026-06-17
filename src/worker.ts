import * as cron from "node-cron";
import * as dotenv from "dotenv";
import { runCollect } from "./index";

dotenv.config();

const CRON_SCHEDULE = process.env.COLLECT_CRON ?? "0 6 * * *"; // 06:00 diariamente

console.log(`[Worker] Iniciado em ${new Date().toISOString()}`);
console.log(`[Worker] Cron agendado: "${CRON_SCHEDULE}" (TZ local do sistema)`);
console.log(`[Worker] Próxima execução: 06:00 do próximo dia útil\n`);

// Execução imediata no startup para validar o pipeline (descomente se desejar)
// runCollect().catch((e) => console.error("[Worker] Erro no startup:", e));

cron.schedule(CRON_SCHEDULE, async () => {
  console.log(`\n[Worker] ⚡ Cron disparado em ${new Date().toISOString()}`);
  try {
    await runCollect();
    console.log(`[Worker] ✓ Coleta finalizada em ${new Date().toISOString()}\n`);
  } catch (err) {
    // Capturado aqui como última linha de defesa — runCollect já captura internamente
    console.error(`[Worker] ✗ Erro inesperado no cron:`, err);
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
