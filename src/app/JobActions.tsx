"use client";

import { useState, useTransition } from "react";
import { rejectJob, updateJobRanking, triggerGeneration, type ActionResult } from "./actions";

interface Props {
  id: string;
  score: number | null;
  lens: string | null;
}

/**
 * Botões de curadoria de uma linha da fila. Client Component:
 * importa só as Server Actions (funções), nunca o PrismaClient.
 */
export function JobActions({ id, score, lens }: Props) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scoreInput, setScoreInput] = useState(score === null ? "" : String(score));
  const [lensInput, setLensInput] = useState(lens ?? "");

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

  function saveRanking(): void {
    const trimmed = scoreInput.trim();
    const parsed = trimmed === "" ? null : Number(trimmed);
    if (parsed !== null && !Number.isFinite(parsed)) {
      setError("score inválido");
      return;
    }
    run(() => updateJobRanking(id, { score: parsed, lens: lensInput.trim() || null }));
  }

  return (
    <div className="actions">
      <div className="actions-row">
        <button type="button" className="btn" disabled={pending} onClick={() => setEditing((v) => !v)}>
          {editing ? "Cancelar" : "Editar"}
        </button>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run(() => triggerGeneration(id))}>
          Gerar candidatura
        </button>
        <button
          type="button"
          className="btn btn-danger"
          disabled={pending}
          onClick={() => {
            if (confirm("Rejeitar esta vaga?")) run(() => rejectJob(id));
          }}
        >
          Rejeitar
        </button>
      </div>

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
          <button type="button" className="btn" disabled={pending} onClick={saveRanking}>
            Salvar
          </button>
        </div>
      )}

      {pending && <span className="msg-pending">processando…</span>}
      {error && <span className="msg-error">erro: {error}</span>}
    </div>
  );
}
