import { spawn } from "node:child_process";

/**
 * Controle do processo de coleta (`npm run collect`) disparado pelo painel.
 *
 * O coletor demora minutos e roda **fora** do ciclo da request HTTP: spawn
 * detached / fire-and-forget. Mantemos só um flag em memória (singleton via
 * globalThis, à prova de HMR como o PrismaClient) para o card de comando saber
 * se já existe uma coleta em andamento — não para controlar o processo.
 */

interface CollectorState {
  running: boolean;
  pid: number | null;
  startedAt: number | null;
}

export interface CollectorStatus {
  running: boolean;
  startedAt: number | null;
}

// Safety-net: se um run nunca reportar `exit` (processo órfão, server reiniciado
// com flag preso), consideramos a coleta encerrada após este teto. Coletas reais
// terminam bem antes disso.
const MAX_RUN_MS = 15 * 60_000;

const KEY = Symbol.for("pesquisa-emprego.collector.state");
type GlobalWithCollector = typeof globalThis & { [KEY]?: CollectorState };
const g = globalThis as GlobalWithCollector;
const state: CollectorState = (g[KEY] ??= { running: false, pid: null, startedAt: null });

function clear(): void {
  state.running = false;
  state.pid = null;
  state.startedAt = null;
}

/** Status atual da coleta. Auto-expira um flag preso além do teto de duração. */
export function collectorStatus(): CollectorStatus {
  if (state.running && state.startedAt !== null && Date.now() - state.startedAt > MAX_RUN_MS) {
    clear();
  }
  return { running: state.running, startedAt: state.startedAt };
}

export type StartResult =
  | { started: true }
  | { started: false; reason: "already-running" };

/**
 * Dispara `npm run collect` em background. Idempotente: se já há coleta rodando,
 * não dispara outra. Retorna imediatamente — o spawn é detached e não bloqueia.
 */
export function startCollector(): StartResult {
  if (collectorStatus().running) return { started: false, reason: "already-running" };

  // `shell: true` resolve o `npm.cmd` no Windows; `detached` desacopla do
  // processo do Next; `stdio: "ignore"` evita encher buffers que nunca lemos.
  const child = spawn("npm", ["run", "collect"], {
    cwd: process.cwd(),
    shell: true,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });

  state.running = true;
  state.pid = child.pid ?? null;
  state.startedAt = Date.now();

  // Enquanto o server do Next viver, ainda recebemos o `exit` do filho detached
  // e podemos baixar o flag. Se o server cair antes, o teto MAX_RUN_MS cobre.
  child.once("exit", clear);
  child.once("error", clear);

  // Não segura o event loop do pai: a coleta segue mesmo se a request encerrar.
  child.unref();

  return { started: true };
}
