"use client";

import { useCallback, useEffect, useState } from "react";
import { subscribeToast, type ToastRecord, type ToastType } from "./toast-bus";

const TOAST_CLASS: Record<ToastType, string> = {
  success: "cleanup-toast-ok",
  error: "cleanup-toast-err",
  info: "cleanup-toast-info",
};
const TOAST_ICON: Record<ToastType, string> = { success: "✅", error: "❌", info: "♻️" };

/** Um toast: auto-dismiss próprio, opcionalmente com botão de ação. */
function ToastItem({ toast, onDismiss }: { toast: ToastRecord; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, toast.durationMs);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);

  return (
    <div role="alert" aria-live="polite" className={`cleanup-toast ${TOAST_CLASS[toast.type]}`}>
      <span aria-hidden="true">{TOAST_ICON[toast.type]}</span>
      <span>{toast.msg}</span>
      {toast.action && (
        <button
          type="button"
          className="cleanup-toast-action"
          onClick={() => {
            toast.action?.run();
            onDismiss();
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        className="cleanup-toast-close btn btn-link"
        onClick={onDismiss}
        aria-label="Fechar notificação"
      >
        ✕
      </button>
    </div>
  );
}

/**
 * Host global de toasts, montado uma vez no layout. Escuta o `toast-bus` e
 * empilha toasts num container fixo — sobrevive ao desmonte de qualquer card.
 */
export function ToastHost() {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  useEffect(
    () => subscribeToast((t) => setToasts((cur) => [...cur, t])),
    [],
  );

  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}
