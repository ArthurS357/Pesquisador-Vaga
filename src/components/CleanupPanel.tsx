"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface SourceCount {
  source: string;
  count: number;
}

interface CleanupData {
  blocked: number;
  lowScore: number;
  olderThan: number;
  all: number;
  sources: SourceCount[];
}

type CleanupAction = "blocked" | "low-score" | "source" | "older-than" | "all";

interface ToastState {
  msg: string;
  type: "success" | "error";
}

// ── Hook de dados ─────────────────────────────────────────────────────────────

function useCleanupData() {
  const [data, setData] = useState<CleanupData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/cleanup");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as CleanupData;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar dados.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return { data, loading, error, reload: load };
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose, toast]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`cleanup-toast ${toast.type === "error" ? "cleanup-toast-err" : "cleanup-toast-ok"}`}
    >
      {toast.type === "success" ? "✅" : "❌"} {toast.msg}
      <button className="cleanup-toast-close btn btn-link" onClick={onClose} aria-label="Fechar notificação">✕</button>
    </div>
  );
}

// ── Modal de confirmação ──────────────────────────────────────────────────────

interface ConfirmModalProps {
  count: number;
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}

function ConfirmModal({ count, label, onConfirm, onCancel, busy }: ConfirmModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
    // .close() em <dialog> já fechado (ex.: Escape) lança DOMException no Chrome.
    return () => { if (dialogRef.current?.open) dialogRef.current.close(); };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="cleanup-dialog"
      aria-modal="true"
      aria-labelledby="cleanup-dialog-title"
      onCancel={onCancel}
    >
      <h3 id="cleanup-dialog-title" className="cleanup-dialog-title">
        🗑️ Confirmar remoção
      </h3>
      <p className="cleanup-dialog-body">
        <strong>{count}</strong> vaga(s) do critério <em>&quot;{label}&quot;</em> serão
        removidas <strong>permanentemente</strong>. Esta ação não pode ser desfeita.
      </p>
      <div className="cleanup-dialog-foot">
        <button className="btn" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
        <button
          className="btn btn-danger"
          onClick={onConfirm}
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? (
            <>
              <span className="cleanup-spinner" aria-hidden="true" />
              Removendo…
            </>
          ) : (
            `Remover ${count} vaga${count !== 1 ? "s" : ""}`
          )}
        </button>
      </div>
    </dialog>
  );
}

// ── Card de critério ──────────────────────────────────────────────────────────

interface CriterionCardProps {
  icon: string;
  label: string;
  description: string;
  count: number;
  loading: boolean;
  onClean: () => void;
}

function CriterionCard({ icon, label, description, count, loading, onClean }: CriterionCardProps) {
  const empty = count === 0 && !loading;

  return (
    <div className="card cleanup-card">
      <div className="cleanup-card-head">
        <span className="cleanup-icon" aria-hidden="true">{icon}</span>
        <div className="cleanup-card-info">
          <span className="cleanup-card-label">{label}</span>
          <span className="meta">{description}</span>
        </div>
        <span className={`badge ${empty ? "cleanup-badge-ok" : "cleanup-badge-count"}`}>
          {loading ? "…" : empty ? "Nada a limpar ✓" : `${count} vaga${count !== 1 ? "s" : ""}`}
        </span>
      </div>
      <button
        className="btn btn-danger cleanup-card-btn"
        disabled={empty || loading}
        onClick={onClean}
        aria-label={`Remover vagas do critério: ${label}`}
      >
        {loading ? (
          <><span className="cleanup-spinner" aria-hidden="true" /> Carregando…</>
        ) : empty ? (
          "Sem vagas"
        ) : (
          `Remover ${count} vaga${count !== 1 ? "s" : ""}`
        )}
      </button>
    </div>
  );
}

// ── Painel principal ──────────────────────────────────────────────────────────

export function CleanupPanel() {
  const { data, loading, error, reload } = useCleanupData();
  const [selectedSource, setSelectedSource] = useState<string>("");
  const [toast, setToast] = useState<ToastState | null>(null);
  const [confirm, setConfirm] = useState<{
    action: CleanupAction;
    label: string;
    count: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  // Sincroniza selectedSource com o primeiro da lista quando carrega
  useEffect(() => {
    if (data?.sources.length && !selectedSource) {
      setSelectedSource(data.sources[0]?.source ?? "");
    }
  }, [data, selectedSource]);

  const showToast = useCallback((msg: string, type: ToastState["type"]) => {
    setToast({ msg, type });
  }, []);

  // Estável: evita que o Toast reinicie o timer de auto-dismiss a cada re-render.
  const closeToast = useCallback(() => setToast(null), []);

  const requestClean = useCallback(
    (action: CleanupAction, label: string, count: number) => {
      if (count === 0) return;
      setConfirm({ action, label, count });
    },
    []
  );

  const handleConfirm = useCallback(async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { action: confirm.action };
      if (confirm.action === "source") body["source"] = selectedSource;
      if (confirm.action === "older-than") body["olderThan"] = 30;

      const res = await fetch("/api/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = (await res.json()) as { removed?: number; error?: string };

      if (!res.ok || json.error) {
        showToast(json.error ?? `Erro HTTP ${res.status}`, "error");
      } else {
        showToast(`${json.removed ?? 0} vaga(s) removidas com sucesso.`, "success");
        await reload();
        // Reseta source selection após limpeza
        if (confirm.action === "source") setSelectedSource("");
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Erro desconhecido.", "error");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }, [confirm, selectedSource, showToast, reload]);

  const sourceCount =
    data?.sources.find((s) => s.source === selectedSource)?.count ?? 0;

  return (
    <section className="cleanup-panel" aria-label="Painel de limpeza do banco">
      <div className="cleanup-header">
        <h2>🧹 Limpeza do Banco</h2>
        <span className="meta">Remove vagas indesejadas com segurança — requer confirmação</span>
      </div>

      {error && (
        <div role="alert" className="cleanup-error">
          ⚠️ {error}{" "}
          <button className="btn btn-link" onClick={reload}>
            Tentar novamente
          </button>
        </div>
      )}

      <div className="cleanup-grid">
        {/* Inativas */}
        <CriterionCard
          icon="🗑️"
          label="Vagas expiradas"
          description="status = INACTIVE — não aparecem mais no dashboard"
          count={data?.blocked ?? 0}
          loading={loading}
          onClean={() => requestClean("blocked", "Vagas expiradas", data?.blocked ?? 0)}
        />

        {/* Score baixo */}
        <CriterionCard
          icon="📉"
          label="Score baixo"
          description="score ≤ 20 ou não avaliadas (nunca passaram no filtro)"
          count={data?.lowScore ?? 0}
          loading={loading}
          onClean={() => requestClean("low-score", "Score baixo", data?.lowScore ?? 0)}
        />

        {/* Não vistas há >30d */}
        <CriterionCard
          icon="⏰"
          label="Não vistas há >30 dias"
          description="lastSeenAt < 30 dias — provavelmente expiradas ou fora do ar"
          count={data?.olderThan ?? 0}
          loading={loading}
          onClean={() => requestClean("older-than", "Não vistas há >30 dias", data?.olderThan ?? 0)}
        />

        {/* Por fonte */}
        <div className="card cleanup-card">
          <div className="cleanup-card-head">
            <span className="cleanup-icon" aria-hidden="true">📦</span>
            <div className="cleanup-card-info">
              <span className="cleanup-card-label">Por fonte</span>
              <span className="meta">Remove todas as vagas de uma fonte específica</span>
            </div>
            <span className={`badge ${sourceCount === 0 ? "cleanup-badge-ok" : "cleanup-badge-count"}`}>
              {loading ? "…" : sourceCount === 0 ? "Nada a limpar ✓" : `${sourceCount} vaga${sourceCount !== 1 ? "s" : ""}`}
            </span>
          </div>
          <div className="cleanup-source-row">
            <select
              className="select"
              value={selectedSource}
              onChange={(e) => setSelectedSource(e.target.value)}
              disabled={loading || !data?.sources.length}
              aria-label="Selecionar fonte para limpeza"
            >
              {!data?.sources.length && <option value="">— nenhuma fonte —</option>}
              {(data?.sources ?? []).map((s) => (
                <option key={s.source} value={s.source}>
                  {s.source} ({s.count})
                </option>
              ))}
            </select>
            <button
              className="btn btn-danger"
              disabled={loading || !selectedSource || sourceCount === 0}
              onClick={() => requestClean("source", `Fonte: ${selectedSource}`, sourceCount)}
              aria-label={`Remover vagas da fonte ${selectedSource}`}
            >
              {loading ? "…" : sourceCount === 0 ? "Sem vagas" : `Remover ${sourceCount}`}
            </button>
          </div>
        </div>

        {/* Limpeza completa */}
        <div className="card cleanup-card cleanup-card-all">
          <div className="cleanup-card-head">
            <span className="cleanup-icon" aria-hidden="true">🧹</span>
            <div className="cleanup-card-info">
              <span className="cleanup-card-label">Limpeza completa</span>
              <span className="meta">Combina todos os critérios acima (deduplica)</span>
            </div>
            <span className={`badge ${(data?.all ?? 0) === 0 ? "cleanup-badge-ok" : "cleanup-badge-danger"}`}>
              {loading ? "…" : (data?.all ?? 0) === 0 ? "Banco limpo ✓" : `${data?.all} vagas`}
            </span>
          </div>
          <button
            className="btn btn-danger cleanup-card-btn"
            disabled={(data?.all ?? 0) === 0 || loading}
            onClick={() => requestClean("all", "Limpeza completa", data?.all ?? 0)}
          >
            {loading ? (
              <><span className="cleanup-spinner" aria-hidden="true" /> Carregando…</>
            ) : (data?.all ?? 0) === 0 ? (
              "Banco limpo"
            ) : (
              `Remover ${data?.all} vagas (todas)`
            )}
          </button>
        </div>
      </div>

      {/* Modal */}
      {confirm && (
        <ConfirmModal
          count={confirm.count}
          label={confirm.label}
          onConfirm={() => void handleConfirm()}
          onCancel={() => setConfirm(null)}
          busy={busy}
        />
      )}

      {/* Toast */}
      {toast && <Toast toast={toast} onClose={closeToast} />}
    </section>
  );
}
