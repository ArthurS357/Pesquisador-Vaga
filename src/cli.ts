/**
 * Entrypoint explícito para execução manual via CLI.
 * Uso: tsx src/cli.ts
 *
 * Separado do index.ts para evitar a detecção frágil de require.main/import.meta
 * que falha com tsx e outros bundlers/loaders que reescrevem process.argv[1].
 */
import { runCollect } from "./index";

console.log("[CLI] Iniciando job-engine...");

runCollect().catch((err) => {
  console.error("[CLI] Erro fatal:", err);
  process.exitCode = 1;
});