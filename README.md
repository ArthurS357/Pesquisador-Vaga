# Job Engine — Pesquisa-Emprego

Motor autônomo de coleta e ranqueamento de vagas com painel local de curadoria **human-in-the-loop**.

**Stack:** TypeScript · Node 22+ · Next.js 16 (App Router) · Prisma 5 · SQLite · Ollama (LLM local)

> Roda 100% local. Sem cloud, sem API paga, sem dependência externa.

---

## Dois processos independentes

O projeto tem duas faces que **não se misturam** — ambas compartilham o mesmo banco (`dev.db`) e o mesmo singleton `PrismaClient` em `src/db/prisma.ts`.

| Processo | Comando | Responsabilidade |
|---|---|---|
| **Painel web** (Next.js) | `npm run dev` | Curadoria, filtros, geração de cartas |
| **Motor de coleta** (CLI) | `npm run collect` | Coleta, ranqueamento, persistência |

---

## Início rápido

```bash
# 1. Dependências
npm install

# 2. Banco de dados
npm run db:push

# 3. Variáveis de ambiente
cp .env.example .env   # editar com credenciais de e-mail, se necessário

# 4. Sobe o painel
npm run dev            # http://localhost:3000

# 5. Coleta (em outro terminal)
npm run collect
```

---

## Stack tecnológica

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js 22+ / TypeScript strict |
| Framework web | Next.js 16 (App Router) |
| ORM / Banco | Prisma 5 / SQLite (`dev.db`) |
| LLM local | Ollama (`qwen3:8b` default) |
| E-mail IMAP | ImapFlow + mailparser |
| DOM parsing | Cheerio |
| Testes | Vitest |

---

## Arquitetura de pastas

```
src/
├── adapters/         # Scrapers por fonte: greenhouse, lever, ashby, email
├── app/              # Next.js App Router
│   ├── page.tsx      # Server Component — busca Prisma, monta o painel
│   ├── actions.ts    # Server Actions (rejeitar, editar, gerar, marcar aplicada)
│   ├── view.ts       # Lógica de filtros/sort/paginação (server + client)
│   ├── status.ts     # Constantes de status compartilhadas
│   ├── JobActions.tsx      # Client Component — ações da fila
│   ├── HistoryActions.tsx  # Client Component — "Marcar como aplicada"
│   └── job/[id]/artifact/  # Rota para exibir carta gerada
├── components/       # UI: JobCard, JobList, JobFilters, StatusTabs, OverviewHero, CleanupPanel
├── core/
│   ├── engine.ts     # Orquestrador da coleta (chunks + dedupe + pipeline de avaliação)
│   ├── ranker.ts     # Estágio 1: heurística local (filtros de role, geo, senioridade, keywords)
│   ├── llm-judge.ts  # Estágio 2: avaliação via Ollama (score + lens + reasoning)
│   ├── generator.ts  # Gerador de cover letter via Ollama
│   ├── ollama.ts     # Client Ollama (fetch + timeout + retry)
│   ├── collector.ts  # Singleton de estado do processo de coleta (fire-and-forget)
│   ├── db-clean-core.ts  # Lógica de limpeza do banco (REJECTED/INACTIVE antigos)
│   └── utils.ts      # fetchWithTimeout, canonicalHash, decodeHtml
├── db/
│   └── prisma.ts     # Singleton PrismaClient (guard de HMR)
└── utils/
    └── profile.ts    # Lê perfil-mestre.md (lazy + cached)
```

---

## Pipeline de coleta

```
index.ts (BOARDS[]) → engine.collect()
    │
    ├── Coleta em chunks de 3 adapters (controle de concorrência)
    │       greenhouse · lever · ashby · email (IMAP incremental)
    │
    ├── Dedupe em memória (Set source:sourceId, mesma run)
    │
    └── Por vaga válida:
            │
            ├── [Estágio 1] ranker.ts — heurística local
            │       ├── ROLE_BLOCK   (sales, non-tech) → descarta
            │       ├── GEO_BLOCK    (fora do Brasil)  → descarta
            │       ├── SENIORITY_BLOCK (sr/lead/…)   → descarta
            │       └── score 0-100 + lens → se score < 25 → LOW_RELEVANCE (descarta)
            │
            ├── [Cache] canonicalHash → pula Estágio 2 se já avaliado
            │
            ├── [Estágio 2] llm-judge.ts — Ollama (qwen3:8b)
            │       └── JSON { score, lens, reasoning } → atualiza vaga
            │
            └── Upsert Prisma (preserva decisão humana se já APPROVED+)
```

### Adaptador de e-mail (IMAP incremental)

O adapter de e-mail usa uma janela incremental baseada no `updatedAt` da última vaga de e-mail persistida, com um piso de 14 dias (`LOOKBACK_FLOOR_DAYS`). Isso garante re-scan de remetentes esparsos sem re-processar todo o histórico.

---

## Máquina de estados (`Job.status`)

```
ACTIVE ──┬─▶ REJECTED
         └─▶ APPROVED ─▶ GENERATING ─▶ GENERATED ─▶ APPLIED
INACTIVE    (vaga sumiu da fonte — oculta no painel)
```

| Status | Significado |
|---|---|
| `ACTIVE` | Fila — aguarda curadoria |
| `APPROVED` | Curador aprovou — aguarda geração de carta |
| `GENERATING` | Carta sendo gerada pelo LLM |
| `GENERATED` | Carta gravada em disco — aguarda revisão humana |
| `APPLIED` | Candidatura confirmada pelo humano |
| `REJECTED` | Descartada pelo curador |
| `INACTIVE` | Soft-delete — vaga sumiu da fonte na última run |

**Regra de autoridade:** o coletor **nunca** sobrescreve decisões humanas (`APPROVED`, `REJECTED`, `GENERATING`, `GENERATED`, `APPLIED`). Só promove para `ACTIVE` vagas novas ou `INACTIVE` (ressurreição).

---

## Painel de curadoria (Next.js)

### OverviewHero — painel de controle

Quatro cards com métricas ao vivo:

- **Vagas monitoradas** — total excluindo `INACTIVE`
- **Fila ativa** — vagas em `ACTIVE` aguardando curadoria
- **Vagas aprovadas** — `APPROVED` + `GENERATING` + `GENERATED` + `APPLIED`
- **Motor de coleta** — botão para disparar `npm run collect` via `/api/collect` (fire-and-forget, com polling de status a cada 4s)

### JobFilters — filtros da fila

Busca por título (debounce 200ms), filtro por fonte, filtro por lens, slider de score mínimo, ordenação (score / data / empresa / título).

### JobList — fila ranqueada

Server Component com paginação. Suporta os filtros acima combinados.

### Histórico

Lista até 100 vagas em `REJECTED`, `GENERATING`, `GENERATED` ou `APPLIED`. Permite navegar até a carta gerada e marcar como aplicada.

### CleanupPanel

Remove vagas antigas `REJECTED`/`INACTIVE` do banco para manter o SQLite enxuto.

---

## Geração de cover letter

Disparada pelo botão **"Gerar candidatura"** na fila (`APPROVED → GENERATING`):

1. Lê a vaga do Prisma + `perfil-mestre.md` (perfil do candidato)
2. Chama Ollama local (modelo `OLLAMA_MODEL`, default `qwen3:8b`) com prompt em pt-BR
3. Grava artefato em `output/cover-letters/{empresa-slug}-{sourceId}.md` (frontmatter YAML + corpo)
4. Status: `GENERATING → GENERATED`

O humano revisa o `.md` e clica **"Marcar como aplicada"** (`→ APPLIED`).

**Sem Ollama:** detecta indisponibilidade, reverte para `APPROVED`, exibe erro no painel. Nada fica preso em `GENERATING`.

---

## Ollama / GPU (RX 7600, 8 GB VRAM)

Roda **nativo no Windows** (não no WSL2). Build 0.13+ inclui ROCm/Vulkan.

**Config crítica — contexto × VRAM:**

| Contexto | VRAM | Velocidade |
|---|---|---|
| 32K (default) | ~10 GB (estoura) | ~10 tok/s (CPU split) |
| 8K (recomendado) | ~6.6 GB (100% GPU) | ~33-41 tok/s |

```powershell
# Já configurado como variável de usuário do Windows:
setx OLLAMA_CONTEXT_LENGTH 8192
```

```bash
npm run ollama:start    # sobe Ollama com contexto correto (idempotente)
npm run ollama:status   # mostra modelo + % GPU (deve ser 100%)
```

| Sintoma | Solução |
|---|---|
| `ollama ps` mostra CPU/GPU split | Confirme `OLLAMA_CONTEXT_LENGTH=8192` e reinicie o Ollama |
| Inferência lenta (60-120s) | GPU não está sendo usada — rode `npm run ollama:status` |
| `Servidor: OFFLINE` | `npm run ollama:start` |

---

## Banco de dados

```bash
npm run db:push          # aplica schema.prisma no dev.db
node node_modules/prisma/build/index.js studio --schema=schema.prisma  # GUI
```

`schema.prisma` fica na raiz (não em `prisma/`) — todo comando precisa de `--schema=schema.prisma`.

---

## Testes

```bash
npm test                 # Vitest
```

Suítes cobertas: `ranker` (heurística + geo + senioridade), `db-clean-core`, `email adapter`, `view` (filtros/sort/paginação).

---

## Adicionar novo adapter

Implemente a interface `JobAdapter`:

```typescript
import { Job, JobAdapter, AdapterContext } from "../core/types";

export function newSourceAdapter(config: { id: string }): JobAdapter {
  return {
    name: `NewSource (${config.id})`,
    fetchJobs: async (ctx?: AdapterContext) => {
      // ctx.since: Date — janela incremental para IMAP; APIs ignoram
      return [
        {
          source: "newsource",
          sourceId: "id_unico_na_fonte",
          company: "Empresa",
          title: "Desenvolvedor",
          location: "Remoto",
          description: "<p>HTML da descrição</p>",
          applyUrl: "https://...",
          updatedAt: new Date(),
        },
      ];
    },
  };
}
```

Registre a instância em `src/index.ts` no array `BOARDS`.

---

## Variáveis de ambiente

| Variável | Default | Descrição |
|---|---|---|
| `OLLAMA_MODEL` | `qwen3:8b` | Modelo Ollama para judge e geração |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Endpoint do servidor Ollama |
| `OLLAMA_CONTEXT_LENGTH` | — | Setado via `setx` no Windows (8192 recomendado) |
| `IMAP_HOST` | — | Host IMAP para o adapter de e-mail |
| `IMAP_USER` | — | Usuário IMAP |
| `IMAP_PASS` | — | Senha/app password IMAP |
| `DATABASE_URL` | `file:./dev.db` | URL do SQLite (Prisma) |
