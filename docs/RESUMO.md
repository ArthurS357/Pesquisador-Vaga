# Resumo do Projeto: Job Engine

Este documento resume as implementações realizadas no motor autônomo de busca e ranqueamento de vagas (`job-engine`) ao longo das 5 etapas de desenvolvimento.

## 🎯 Objetivo do Projeto
Criar um motor autônomo (Worker CLI) para coletar, deduplicar, ranquear e persistir vagas de emprego de múltiplas fontes (ATS e e-mails de alerta), utilizando uma arquitetura modular, resiliente e tipada, com avaliação inteligente de aderência ao perfil do candidato.

## 🏗 Etapas Implementadas

### Passo 1: Fundação, Resiliência e Prisma
- **Padrão Adapter**: Criação da interface base `JobAdapter` e estruturação inicial.
- **Resiliência**: Implementação de controle de concorrência em *chunks* e timeout nas requisições HTTP (`fetchWithTimeout` usando `AbortController`).
- **Persistência**: Criação do `schema.prisma` inicial com *upsert* baseado em chaves compostas (`[source, sourceId]`) para evitar duplicações no banco de dados.

### Passo 2: Modularização e Adapters de ATS
- **Reorganização Estrutural**: O código foi dividido em módulos coesos (`src/core`, `src/adapters`, `src/db`).
- **Prisma Singleton**: Implementação de um `PrismaClient` usando o padrão Singleton (`src/db/prisma.ts`) para evitar vazamento de conexões, especialmente útil em ambientes de desenvolvimento (HMR).
- **Adapters Abertos**: Implementação completa dos adapters para **Greenhouse**, **Lever** e **Ashby**.

### Passo 3: Adapters Fechados (E-mail)
- **Leitura IMAP**: Criação do `EmailAlertAdapter` (`src/adapters/email.ts`) utilizando `imapflow` para leitura segura de e-mails via IMAP.
- **Parsing de HTML**: Uso do `mailparser` e `cheerio` para extrair informações de e-mails de alerta do **LinkedIn** e da **Gupy**.
- **IDs Determinísticos**: Geração de `sourceId` unívoco baseado no hash seguro (SHA-256) da URL base, evitando duplicatas.

### Passo 4: Refinamentos de Persistência e Heurística (Ranker)
- **Deduplicação Cross-Source**: Inserção do `canonicalHash` (hash de empresa + título) para identificar a mesma vaga postada em diferentes fontes.
- **Soft-Delete**: Adição do campo `lastSeenAt` no banco. Vagas não vistas na execução atual recebem o status `INACTIVE` (soft-delete).
- **Resolução de Redirects**: Criação da função `resolveTrackingUrl` para limpar links de rastreamento de e-mails, com limite de *redirects* para evitar loops infinitos.
- **Heurística Inicial**: Implementação do `ranker.ts` com sistema de pontuação (*score*) baseado em palavras-chave (boosts e penalidades) e classificação por área (*lens*).

### Passo 5: Pipeline Híbrido com LLM (Ollama)
- **Estágio 1 (Heurística)**: Vagas com score heurístico abaixo de 25 recebem flag `LOW_RELEVANCE` e são puladas, economizando recursos.
- **Estágio 2 (LLM Judge)**: Vagas relevantes são enviadas a uma LLM local via Ollama (`src/core/llm-judge.ts`). O sistema lê o contexto do `perfil-mestre.md` e solicita que a LLM analise a vaga em formato JSON estrito (`score`, `lens`, `reasoning`).
- **Cache e Fallback**: O motor verifica se a vaga já foi avaliada anteriormente usando o `canonicalHash` (evitando reprocessamento). Caso o Ollama falhe, o sistema aplica fallback seguro para a pontuação heurística, garantindo que o pipeline não quebre.

---

## 🛠 Stack Tecnológica Utilizada
- **Linguagem**: TypeScript / Node.js
- **Banco de Dados**: SQLite (gerenciado pelo Prisma ORM)
- **E-mail**: `imapflow` (IMAP) e `mailparser` (Parsing EML)
- **Web Scraping/Parsing**: `cheerio`
- **Variáveis de Ambiente**: `dotenv`
- **Inteligência (LLM)**: Ollama (Integração via `fetch` POST)
