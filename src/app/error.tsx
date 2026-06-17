"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="wrap">
      <div className="state" role="alert">
        <span className="state-icon">⚠️</span>
        <p>Falha ao carregar as vagas.</p>
        <button type="button" className="btn btn-primary" onClick={reset} style={{ marginTop: "0.75rem" }}>
          Tentar novamente
        </button>
      </div>
    </main>
  );
}
