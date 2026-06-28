/**
 * toast-bus — pub/sub mínimo (sem dependência) para toasts globais.
 *
 * Por que global e não por card: ao rejeitar, a vaga sai da fila (QUEUE_STATUS_LIST)
 * e o `JobCard`/`JobActions` desmonta no revalidate. Um toast renderizado dentro do
 * card morreria junto — sem janela de "Desfazer". O `ToastHost` vive no layout
 * (acima da árvore que desmonta) e escuta este barramento.
 */

export type ToastType = "success" | "error" | "info";

/** Ação opcional do toast (ex.: "Desfazer"). `run` dispara ao clicar. */
export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastInput {
  msg: string;
  type?: ToastType;
  /** Auto-dismiss em ms. Default 5000. */
  durationMs?: number;
  action?: ToastAction;
}

export interface ToastRecord {
  id: number;
  msg: string;
  type: ToastType;
  durationMs: number;
  action?: ToastAction;
}

type Listener = (t: ToastRecord) => void;

const listeners = new Set<Listener>();
let seq = 0;

/** Emite um toast para o host global. Seguro chamar de componente desmontando. */
export function showToast(input: ToastInput): number {
  const rec: ToastRecord = {
    id: ++seq,
    msg: input.msg,
    type: input.type ?? "info",
    durationMs: input.durationMs ?? 5000,
    action: input.action,
  };
  for (const l of listeners) l(rec);
  return rec.id;
}

/** Assina o barramento. Retorna a função de cleanup (uso direto em useEffect). */
export function subscribeToast(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
