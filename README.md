# Job Engine Architecture

Motor autônomo para coleta e persistência de vagas de emprego (ATS abertos e alertas de e-mail fechados).

## 🛠 Stack Tecnológica
- **Linguagem**: TypeScript / Node.js
- **ORM / DB**: Prisma / SQLite (Pronto para PG/MySQL)
- **Rede / I/O**: fetch nativo (c/ AbortController timeout)
- **E-mail**: ImapFlow (leitura), mailparser (decodificação)
- **DOM Parsing**: Cheerio (Regex safe)
- **Env**: dotenv

## 📁 Arquitetura de Pastas
- `src/core/`: Motor central. Contém `types.ts` (`Job`, `JobAdapter`), `utils.ts` (`fetchWithTimeout`), e `engine.ts` (controle de chunks e deduplicação).
- `src/db/`: Singleton do `PrismaClient`. Evita vazamento de conexão.
- `src/adapters/`: Scrapers/Parsers isolados. `greenhouse.ts`, `lever.ts`, `ashby.ts` e `email.ts`.
- `src/index.ts`: Entrypoint. Instancia adapters e orquestra a coleta.

## 🔄 Fluxo de Execução
1. **Trigger**: `index.ts` monta `BOARDS` (array de adapters configurados).
2. **Fetch Seguro**: `engine.collect()` roda adapters em lotes (chunks de 3). Previne 429 e exaustão de descritores de arquivo do OS.
3. **Parse & Normalização**: Adapters convertem payload sujo (JSON/HTML) no formato comum `Job`.
4. **Deduplicação Memória**: `collect` filtra duplicatas na mesma run (Set de `source:sourceId`).
5. **Persistência (Upsert)**: Prisma grava no BD. Se vaga existe (chave composta `[source, sourceId]`), atualiza. Se não, insere.
6. **Teardown**: Bloco finally força `prisma.$disconnect()`.

## 🧩 Adicionar Novo Adapter
Qualquer fonte deve implementar a interface `JobAdapter`.

```typescript
import { Job, JobAdapter, AdapterContext } from "../core/types";

export function newSourceAdapter(config: { id: string }): JobAdapter {
  return {
    name: `NewSource (${config.id})`,
    fetchJobs: async (ctx?: AdapterContext) => {
      // 1. Fetch API (usar fetchWithTimeout) ou ler payload
      // 2. Extrair dados
      // 3. Retornar array padronizado
      return [
        {
          source: "newsource",
          sourceId: "id_unico_na_fonte", // Crucial para o DB
          company: "Empresa",
          title: "Desenvolvedor",
          location: "Remoto",
          description: "<p>HTML</p>",
          applyUrl: "https://...",
          updatedAt: new Date()
        }
      ];
    }
  };
}
```
