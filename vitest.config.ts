import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Config de testes unitários do job-engine.
 * Ambiente `node` — cobre funções puras de core/, adapters/ e helpers do painel.
 * Componentes React (.tsx) não são testados aqui (exigiriam jsdom + testing-library).
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
