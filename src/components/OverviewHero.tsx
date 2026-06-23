"use client";

import { useCallback, useEffect, useState } from "react";
import type { CollectorStatus } from "@/core/collector";

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface OverviewMetrics {
  /** Vagas vivas (todas menos INACTIVE) — o universo monitorado. */
  monitored: number;
  /** Total bruto no banco, incluindo expiradas. */
  totalAll: number;
  /** Fila ativa aguardando curadoria (status = ACTIVE). */
  active: number;
  /** Vagas que passaram pela curadoria (APPROVED em diante). */
  approved: number;
  /** approved / monitored, em %. */
  conversionPct: number;
}

interface ToastState {
  msg: string;
  type: "ok" | "err";
}

const POLL_MS = 4000;

// ── Card de métrica (apresentacional) ─────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: number;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div className="card hero-card">
      <span className="hero-label">{label}</span>
      <span className={`hero-value${accent ? " hero-accent" : ""}`}>{value}</span>
      <span className="hero-sub">{sub}</span>
    </div>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [toast, onClose]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`cleanup-toast ${toast.type === "err" ? "cleanup-toast-err" : "cleanup-toast-ok"}`}
    >
      {toast.type === "ok" ? "✅" : "❌"} {toast.msg}
      <button
        className="cleanup-toast-close btn btn-link"
        onClick={onClose}
        aria-label="Fechar notificação"
      >
        ✕
      </button>
    </div>
  );
}

// ── Painel de Controle de Missão ──────────────────────────────────────────────

export function OverviewHero({
  metrics,
  initialStatus,
}: {
  metrics: OverviewMetrics;
  initialStatus: CollectorStatus;
}) {
  const [running, setRunning] = useState(initialStatus.running);
  const [dispatching, setDispatching] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  // Enquanto a coleta roda, faz polling do status para detectar o fim e voltar
  // o card para "Disponível" sem o humano precisar recarregar a página.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      void (async () => {
        try {
          const res = await fetch("/api/collect", { cache: "no-store" });
          if (!res.ok) return;
          const status = (await res.json()) as CollectorStatus;
          setRunning(status.running);
        } catch {
          /* erro transitório de rede — tenta de novo no próximo tick */
        }
      })();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [running]);

  const runCollector = useCallback(async () => {
    setDispatching(true);
    try {
      const res = await fetch("/api/collect", { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { status?: string };

      if (res.status === 409 || json.status === "already-running") {
        setRunning(true);
        setToast({ msg: "Coletor já está rodando em background.", type: "err" });
        return;
      }
      if (!res.ok) {
        setToast({ msg: "Falha ao acionar o coletor.", type: "err" });
        return;
      }

      setRunning(true);
      setToast({
        msg: "Coletor acionado! O processo está rodando no terminal do Node.",
        type: "ok",
      });
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Erro ao acionar coletor.", type: "err" });
    } finally {
      setDispatching(false);
    }
  }, []);

  const busy = dispatching || running;
  const expired = metrics.totalAll - metrics.monitored;

  return (
    <section className="hero" aria-label="Painel de controle">
      <div className="hero-grid">
        <MetricCard
          label="Vagas monitoradas"
          value={metrics.monitored}
          sub={`${metrics.totalAll} no banco · ${expired} expiradas`}
        />
        <MetricCard
          label="Fila ativa"
          value={metrics.active}
          sub="aguardando curadoria"
          accent
        />
        <MetricCard
          label="Vagas aprovadas"
          value={metrics.approved}
          sub={`${metrics.conversionPct}% de conversão`}
        />

        {/* Card de comando — o motor */}
        <div className="card hero-card hero-cmd">
          <div className="hero-cmd-head">
            <span className="hero-label">Motor de coleta</span>
            <span className={`hero-status ${running ? "hero-status-running" : "hero-status-idle"}`}>
              {running ? "🟡 Rodando em background…" : "🟢 Disponível"}
            </span>
          </div>
          <button
            type="button"
            className="btn btn-primary hero-run-btn"
            onClick={() => void runCollector()}
            disabled={busy}
            aria-busy={busy}
          >
            {dispatching ? (
              <>
                <span className="cleanup-spinner" aria-hidden="true" /> Iniciando motor…
              </>
            ) : running ? (
              <>
                <span className="cleanup-spinner" aria-hidden="true" /> Coletando…
              </>
            ) : (
              "▶ Executar Coletor"
            )}
          </button>
        </div>
      </div>

      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
    </section>
  );
}
