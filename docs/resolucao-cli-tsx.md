# Documentação: Resolução do Problema de Execução Manual (CLI) via `tsx`

## Contexto do Problema

O sistema original (`src/index.ts`) possuía um bloco condicional no final do arquivo destinado a detectar se ele estava sendo executado diretamente pela linha de comando (CLI). O objetivo era invocar a função `runCollect()` apenas se o script fosse o "main".

```typescript
// Código original com problema:
const isMain = process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js");
if (isMain) {
  runCollect().then(() => process.exit(0));
}
```

Ao executar o comando `npm run collect` (que chamava `tsx src/index.ts`), o processo terminava silenciosamente com sucesso, mas a função `runCollect()` **não era executada** e nenhum log aparecia.

## A Causa Raiz

A falha ocorria por causa da forma como o `tsx` (TypeScript Execute) funciona. Quando invocamos `tsx src/index.ts`, o executor principal (`process.argv[1]`) é na verdade o próprio _loader_ do `tsx` (algo como `.../tsx/dist/esm/loader.js`), e não o arquivo `index.ts`. 

Como resultado, a condição `isMain` (`endsWith("index.ts")`) era avaliada como `false`, o bloco `if` era ignorado, e o script simplesmente terminava após exportar a função, sem gerar erros, mas também sem realizar o trabalho.

## A Solução Implementada

Para resolver isso de forma robusta e eliminar a detecção frágil de ambiente, adotamos uma abordagem de **entrypoint explícito**. A lógica de execução manual foi separada da lógica principal do serviço.

### 1. Novo Entrypoint: `src/cli.ts`
Criamos um novo arquivo dedicado **exclusivamente** para ser chamado via linha de comando. Ele importa a função principal e a executa diretamente, tratando possíveis erros.

```typescript
// src/cli.ts
import { runCollect } from "./index";

runCollect()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[CLI] Erro fatal:", err);
    process.exit(1);
  });
```

### 2. Limpeza em `src/index.ts`
Removemos completamente a condicional `isMain`. O arquivo `index.ts` agora atua apenas como um módulo que declara dependências e exporta a função `runCollect`, livre de efeitos colaterais na importação.

### 3. Atualização do `package.json`
O script do NPM foi atualizado para apontar para o novo arquivo de CLI.

```json
// Antes
"collect": "prisma db push --schema=schema.prisma --skip-generate ; tsx src/index.ts"

// Depois
"collect": "prisma db push --schema=schema.prisma --skip-generate ; tsx src/cli.ts"
```

## Impacto na Arquitetura

Esta refatoração, embora simples, traz benefícios arquiteturais importantes:

1. **Responsabilidade Única**: `index.ts` exporta a lógica de negócio, `cli.ts` gerencia a interface de linha de comando.
2. **Segurança no Worker**: O arquivo `src/worker.ts` (responsável pelo agendamento Cron) já importava o `index.ts`. A remoção da condicional garante que nunca haverá risco do worker executar a rotina acidentalmente no momento do import.
3. **Resiliência a Ferramentas**: Não dependemos mais da estrutura de argumentos do processo (`process.argv`), tornando o código imune a mudanças de comportamento entre diferentes runners (node, tsx, ts-node, bun, etc).

A execução manual via `npm run collect` foi validada com sucesso, processando os dados e interagindo com o modelo LLM conforme esperado.
