# Job Engine — Pesquisa-Emprego

Motor de coleta/ranqueamento de vagas + painel local de **curadoria human-in-the-loop**.
Stack: TypeScript · Node 22+ · Next.js 16 (App Router) · Prisma 5 · SQLite. Roda **100% local**.

## Dois processos independentes

O projeto tem duas faces que **não se misturam**: o motor CLI (coleta) e o painel web (curadoria).
Ambos compartilham o mesmo banco (`dev.db`) e o mesmo singleton `PrismaClient` em `src/db/prisma.ts`.

### 1. Painel de curadoria (Next.js)

Interface para revisar a fila ranqueada, editar score/lens, rejeitar e disparar geração.

```bash
npm run dev      # sobe o painel em http://localhost:3000
npm run build    # build de produção (valida tipagem contra o Prisma)
npm run start    # serve o build
```

Fluxo: **ver fila ranqueada → curadoria humana (rejeitar / editar score+lens) → aprovar e gerar candidatura**.

### 2. Motor de coleta (CLI)

Bate nas fontes (Greenhouse etc.), normaliza e persiste vagas. Roda via `tsx`, **fora** do bundle do Next.

```bash
npm run collect  # = tsx src/index.ts  (greenhouse + lever + ashby + email → ranker → LLM judge → Prisma)
```

> O painel **não** dispara a coleta. Rode o coletor separadamente; depois abra/atualize o painel.
> `job-engine-step1.ts` na raiz é a fatia vertical do Passo 1 (legado/referência), não o motor atual.

## Banco de dados

```bash
npm run db:push                              # aplica schema.prisma no dev.db (sqlite)
node node_modules/prisma/build/index.js studio --schema=schema.prisma   # inspeção visual
```

Schema fica em `schema.prisma` (raiz, **não** em `prisma/`) — por isso todo comando precisa de `--schema=schema.prisma`.

## Máquina de estados (`Job.status`, string)

```
ACTIVE ──┬─▶ REJECTED                                       (curadoria descarta)
         └─▶ APPROVED ─▶ GENERATING ─▶ GENERATED ─▶ APPLIED
INACTIVE = vaga sumiu da fonte (coletor). Oculta no painel.
```

- `GENERATING` = carta sendo redigida pelo LLM.  `GENERATED` = carta no disco, aguardando revisão/envio.  `APPLIED` = humano confirmou envio.
- **Fila** (`src/app/page.tsx`): mostra `ACTIVE` + `APPROVED`, ordenado por `score desc`.
- **Histórico**: mostra `GENERATING` / `GENERATED` / `APPLIED` / `REJECTED`.

### Regra de autoridade coletor × curadoria
O coletor (`engine.ts`) **só** promove uma vaga a `ACTIVE` se ela for nova ou estiver `INACTIVE` (ressurreição). Decisões humanas (`APPROVED`/`REJECTED`/`GENERATING`/`GENERATED`/`APPLIED`) **nunca** são sobrescritas por uma nova run de coleta.

## Arquitetura do painel

| Arquivo | Papel |
|---|---|
| `src/app/page.tsx` | **Server Component**. Busca vagas no Prisma. Sem `"use client"`. |
| `src/app/actions.ts` | **Server Actions** (`"use server"`): `rejectJob`, `updateJobRanking`, `triggerGeneration`, `markApplied`. Validam input no servidor e chamam `revalidatePath("/")`. |
| `src/app/JobActions.tsx` | **Client Component** (fila): editar/rejeitar/gerar. Só importa funções de action — nunca o `PrismaClient`. |
| `src/app/HistoryActions.tsx` | **Client Component** (histórico): botão "Marcar como aplicada" (`GENERATED → APPLIED`). |
| `src/app/status.ts` | Constantes de status compartilhadas (server + client). |
| `src/core/generator.ts` | Gerador de Cover Letter: prompt + chamada Ollama + artefato em disco. Server-only, usado por `actions.ts` e `page.tsx`. |
| `src/db/prisma.ts` | Singleton do `PrismaClient` (guard de HMR). Reusado por CLI e painel. |
| `next.config.ts` | `serverExternalPackages: ["@prisma/client"]` — mantém o Prisma fora do bundle cliente. |

## Geração de candidatura (Passo 7)

`triggerGeneration` (acionado pelo botão "Gerar candidatura"):
1. Lê o contexto da vaga **do Prisma** (sem scraping) + `perfil-mestre.md`.
2. Chama o **Ollama local** (`localhost:11434`, modelo `OLLAMA_MODEL`, default `qwen3:8b`) para redigir a carta.
3. Grava o artefato em `output/cover-letters/{empresa-slug}-{sourceId}.md` (frontmatter + corpo).
4. Status `GENERATING → GENERATED`. Você revisa o `.md` e clica **"Marcar como aplicada"** (`→ APPLIED`).

- **Sem Ollama no ar**: a geração detecta a indisponibilidade, reverte o status para `APPROVED` e mostra o erro no painel (nada fica preso em `GENERATING`).
- Se a vaga não tiver `description` persistida, a prompt degrada graciosamente (foca em título + empresa + lens). Scraping da apply URL ficou fora de escopo (fragilidade por-ATS).

## Ollama / aceleração GPU (RX 7600, 8 GB)

O Ollama roda **nativo no Windows** (não no WSL2). A build 0.13+ já traz ROCm/Vulkan
embutido e usa a **RX 7600** sem ROCm instalado à parte. O `localhost:11434` que o
job-engine chama é o próprio Ollama do Windows.

**Config crítica — contexto x VRAM.** O contexto default do qwen3 (32K) infla o KV cache
para ~10 GB e estoura os 8 GB da placa, forçando um split CPU/GPU (~10 tok/s). Capando o
contexto em **8192**, o modelo inteiro cabe (6.6 GB → **100% GPU**, ~33-41 tok/s):
inferência cai de 60-120s para ~3-5s e a carta para ~10-15s.

```powershell
# Variável de ambiente do USUÁRIO (já configurada; vale para todos os modelos):
setx OLLAMA_CONTEXT_LENGTH 8192
```

> Sem mexer no código: o cap é feito via env var do servidor, não em `llm-judge.ts`/`generator.ts`.

**Comandos:**

```bash
npm run ollama:start    # sobe o Ollama com o contexto correto (idempotente)
npm run ollama:status   # mostra modelos + onde o modelo carregado roda (deve dizer "100% GPU")
```

**Troubleshooting:**

| Sintoma | Causa / Solução |
|---|---|
| `ollama ps` mostra `x%/y% CPU/GPU` | Contexto estourou a VRAM. Confirme `OLLAMA_CONTEXT_LENGTH=8192` e **reinicie o Ollama** (a var só é lida no launch). |
| Inferência voltou a 60-120s | GPU não está sendo usada — quase sempre é o contexto. Rode `npm run ollama:status`. |
| `Servidor: OFFLINE` | `npm run ollama:start`. |
| Driver AMD desatualizado | Atualize o Adrenalin; a build atual (`32.0.31019+`) funciona. |

> **WSL2 + ROCm não é necessário** e foi descartado: a RX 7600 é gfx1102, fora da lista
> oficial de GPUs do ROCm, e o caminho via WSL não traria ganho sobre a config nativa acima.

## Regras técnicas

- TypeScript strict. Nada de `any`. Server Actions retornam `ActionResult` (união discriminada `{ ok } | { ok; error }`).
- Toda mutação valida o input **no servidor** — o cliente nunca é fonte de verdade.
- Não reintroduzir `"type": "commonjs"` no `package.json`: conflita com o ESM dos arquivos do Next (quebra o build do Turbopack).
