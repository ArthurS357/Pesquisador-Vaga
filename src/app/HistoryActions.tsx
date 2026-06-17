"use client";

import { useState, useTransition } from "react";
import { markApplied, type ActionResult } from "./actions";

/**
 * Ação do histórico para vagas em GENERATED: confirmar envio → APPLIED.
 * Client Component: importa só a Server Action, nunca o PrismaClient.
 */
export function MarkAppliedButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(): void {
    setError(null);
    startTransition(async () => {
      const res: ActionResult = await markApplied(id);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <button type="button" className="btn btn-primary" disabled={pending} onClick={run}>
        {pending ? "…" : "Marcar como aplicada"}
      </button>
      {error && <span className="msg-error">erro: {error}</span>}
    </span>
  );
}
