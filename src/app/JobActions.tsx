"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  rejectJob, applyJob, updateJobRanking, triggerGeneration, revalidateJob, type ActionResult,
} from "./actions";
import { HamburgerMenu, type MenuAction } from "@/components/HamburgerMenu";

interface Props {
  id: string;
  title: string;
  company: string;
  description: string | null;
  score: number | null;
  lens: string | null;
  /** Dispara o status otimista no JobCard (curadoria em lote sem esperar o RTT). */
  onOptimisticStatus?: (status: string) => void;
}

interface Toast {
  msg: string;
  type: "success" | "error" | "info";
}

const TOAST_CLASS: Record<Toast["type"], string> = {
  success: "cleanup-toast-ok",
  error: "cleanup-toast-err",
  info: "cleanup-toast-info",
};
const TOAST_ICON: Record<Toast["type"], string> = { success: "✅", error: "❌", info: "♻️" };

/** Toast reutiliza as classes do CleanupPanel. Auto-dismiss em 5s. */
function ActionToast({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 5000);
    return () => clearTimeout(t);
  }, [onClose, toast]);

  return (
    <div role="alert" aria-live="polite" className={`cleanup-toast ${TOAST_CLASS[toast.type]}`}>
      {TOAST_ICON[toast.type]} {toast.msg}
      <button className="cleanup-toast-close btn btn-link" onClick={onClose} aria-label="Fechar notificação">✕</button>
    </div>
  );
}

const MIN_CHARS = 20;

/**
 * Modal de reavaliação: cola descrição/requisitos da vaga p/ o LLM julgar com
 * contexto rico. <dialog> nativo (Escape fecha, foco no textarea ao abrir).
 */
function RevalidateModal({
  title, company, description, busy, onCancel, onSubmit,
}: {
  title: string;
  company: string;
  description: string | null;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (text: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");

  useEffect(() => {
    dialogRef.current?.showModal();
    textareaRef.current?.focus();
    return () => dialogRef.current?.close();
  }, []);

  const tooShort = text.trim().length < MIN_CHARS;

  return (
    <dialog
      ref={dialogRef}
      className="cleanup-dialog revalidate-dialog"
      aria-modal="true"
      aria-labelledby="revalidate-title"
      onCancel={onCancel}
    >
      <h3 id="revalidate-title" className="cleanup-dialog-title">🔄 Reavaliar: {title}</h3>
      <p className="meta">{company}</p>

      {description?.trim() && (
        <details className="reasoning">
          <summary>Descrição original do anúncio</summary>
          <p className="reasoning-body">{description.slice(0, 500)}</p>
        </details>
      )}

      <textarea
        ref={textareaRef}
        className="input revalidate-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Cole aqui a descrição completa da vaga, requisitos, ou qualquer informação adicional…"
        rows={8}
        maxLength={10000}
        disabled={busy}
        aria-label="Informações adicionais da vaga"
      />
      <span className="meta char-count">
        {text.length} caracteres{tooShort ? ` · mínimo ${MIN_CHARS}` : ""}
      </span>

      <div className="cleanup-dialog-foot">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancelar</button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onSubmit(text)}
          disabled={busy || tooShort}
          aria-busy={busy}
        >
          {busy
            ? <><span className="cleanup-spinner" aria-hidden="true" /> Reavaliando…</>
            : "Reavaliar com Qwen3"}
        </button>
      </div>
    </dialog>
  );
}

/**
 * Botões de curadoria de uma linha da fila. Client Component:
 * importa só as Server Actions (funções), nunca o PrismaClient.
 */
export function JobActions({
  id, title, company, description, score, lens, onOptimisticStatus,
}: Props) {
  const [pending, startTransition] = useTransition();
  // Transition dedicada: o spinner do "Reavaliar" não acende em outras ações.
  const [revalidating, startRevalidate] = useTransition();
  const [editing, setEditing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [scoreInput, setScoreInput] = useState(score === null ? "" : String(score));
  const [lensInput, setLensInput] = useState(lens ?? "");

  const busy = pending || revalidating;

  function run(fn: () => Promise<ActionResult>): void {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error);
      } else {
        setEditing(false);
      }
    });
  }

  function submitRevalidate(additionalText: string): void {
    setError(null);
    startRevalidate(async () => {
      const res = await revalidateJob(id, additionalText);
      if (res.ok) {
        // revalidatePath("/") no servidor já refresca o badge do card.
        setModalOpen(false);
        setToast({
          msg: `${res.data.fromCache ? "Resultado recuperado do cache" : "Vaga reavaliada"} — Score: ${Math.round(res.data.score)}/100`,
          type: res.data.fromCache ? "info" : "success",
        });
      } else {
        // Mantém o modal aberto p/ retry sem recolar o texto.
        setToast({ msg: res.error, type: "error" });
      }
    });
  }

  function reject(): void {
    if (!confirm("Rejeitar esta vaga?")) return;
    setError(null);
    startTransition(async () => {
      // Otimista: card escurece na hora (dentro da transition). Em caso de erro,
      // rejectJob NÃO chama revalidatePath → o status base volta a valer e o
      // useOptimistic reverte sozinho ao fim da transition.
      onOptimisticStatus?.("REJECTED");
      const res = await rejectJob(id);
      if (!res.ok) setToast({ msg: res.error, type: "error" });
    });
  }

  function apply(): void {
    setError(null);
    startTransition(async () => {
      // Mesmo padrão do reject: badge verde "Aplicada" + esmaecimento na hora.
      // Em erro, applyJob não revalida → useOptimistic reverte ao normal.
      onOptimisticStatus?.("APPLIED");
      const res = await applyJob(id);
      if (!res.ok) setToast({ msg: res.error, type: "error" });
    });
  }

  function saveRanking(): void {
    const trimmed = scoreInput.trim();
    const parsed = trimmed === "" ? null : Number(trimmed);
    if (parsed !== null && !Number.isFinite(parsed)) {
      setError("score inválido");
      return;
    }
    run(() => updateJobRanking(id, { score: parsed, lens: lensInput.trim() || null }));
  }

  // Ações de curadoria + ferramentas primeiro; a destrutiva (Rejeitar) isolada
  // abaixo de um separador. Tudo desabilitado enquanto uma ação está em curso.
  const menuActions: MenuAction[] = [
    { key: "apply", icon: "✅", label: "Aplicar", onSelect: apply, disabled: busy },
    { key: "generate", icon: "📝", label: "Gerar Carta", onSelect: () => run(() => triggerGeneration(id)), disabled: busy },
    { key: "revalidate", icon: "🔄", label: "Reavaliar", onSelect: () => setModalOpen(true), disabled: busy },
    { key: "edit", icon: "✏️", label: editing ? "Cancelar edição" : "Editar score/lens", onSelect: () => setEditing((v) => !v), disabled: busy },
    { key: "reject", icon: "❌", label: "Rejeitar", onSelect: reject, variant: "danger", disabled: busy, separatorBefore: true },
  ];

  return (
    <div className="actions">
      <HamburgerMenu actions={menuActions} label={`Ações: ${title}`} disabled={busy} />

      {editing && (
        <div className="edit-row">
          <label>
            Score
            <input
              className="input"
              type="number"
              step="any"
              value={scoreInput}
              onChange={(e) => setScoreInput(e.target.value)}
              style={{ width: 80 }}
            />
          </label>
          <label>
            Lens
            <input
              className="input"
              type="text"
              value={lensInput}
              onChange={(e) => setLensInput(e.target.value)}
              style={{ width: 120 }}
            />
          </label>
          <button type="button" className="btn" disabled={busy} onClick={saveRanking}>
            Salvar
          </button>
        </div>
      )}

      {busy && <span className="msg-pending">processando…</span>}
      {error && <span className="msg-error">erro: {error}</span>}
      {toast && <ActionToast toast={toast} onClose={() => setToast(null)} />}

      {modalOpen && (
        <RevalidateModal
          title={title}
          company={company}
          description={description}
          busy={revalidating}
          onCancel={() => setModalOpen(false)}
          onSubmit={submitRevalidate}
        />
      )}
    </div>
  );
}
