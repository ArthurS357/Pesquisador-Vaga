"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  buildQuery, SORT_OPTIONS, sourceLabel, lensLabel,
  type JobFilterState, type SortKey,
} from "@/app/view";

interface Props {
  current: JobFilterState;
  sources: string[];
  lenses: string[];
}

export function JobFilters({ current, sources, lenses }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [min, setMin] = useState(current.min);

  // Ressincroniza o slider quando a URL muda por fora (back/forward do browser):
  // useState não re-inicializa com a nova prop sozinho.
  useEffect(() => setMin(current.min), [current.min]);

  // Toda mudança de filtro reseta a página e sobe a lista suavemente.
  function commit(override: Partial<JobFilterState>): void {
    const url = buildQuery(current, { page: 1, ...override });
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    startTransition(() => {
      router.replace(url, { scroll: false });
      window.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
    });
  }

  function toggle(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  const dirty =
    current.sources.length > 0 || current.lenses.length > 0 ||
    current.min > 0 || current.sort !== "score";

  return (
    <details className="filters" open>
      <summary aria-label="Abrir filtros">Filtros{pending ? " · atualizando…" : ""}</summary>
      <div className="filters-body">
        <fieldset className="field" style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="label">Fonte</legend>
          <div className="checks">
            {sources.length === 0 && <span className="meta">—</span>}
            {sources.map((s) => (
              <label key={s} className="chip">
                <input
                  type="checkbox"
                  checked={current.sources.includes(s)}
                  onChange={() => commit({ sources: toggle(current.sources, s) })}
                />
                {sourceLabel(s)}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="field" style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="label">Lens</legend>
          <div className="checks">
            {lenses.length === 0 && <span className="meta">—</span>}
            {lenses.map((l) => (
              <label key={l} className="chip">
                <input
                  type="checkbox"
                  checked={current.lenses.includes(l)}
                  onChange={() => commit({ lenses: toggle(current.lenses, l) })}
                />
                {lensLabel(l)}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="field">
          <label className="label" htmlFor="min-score">Score mínimo</label>
          <div className="range-row">
            <input
              id="min-score"
              type="range"
              min={0}
              max={100}
              step={5}
              value={min}
              onChange={(e) => setMin(Number(e.target.value))}
              onPointerUp={() => commit({ min })}
              onKeyUp={() => commit({ min })}
            />
            <span className="range-val">{min}</span>
          </div>
        </div>

        <div className="field">
          <label className="label" htmlFor="sort">Ordenar por</label>
          <select
            id="sort"
            className="select"
            value={current.sort}
            onChange={(e) => commit({ sort: e.target.value as SortKey })}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {dirty && (
          <div className="field" style={{ justifyContent: "flex-end" }}>
            <button
              type="button"
              className="btn btn-link"
              onClick={() => { setMin(0); commit({ sources: [], lenses: [], min: 0, sort: "score" }); }}
            >
              Limpar filtros
            </button>
          </div>
        )}
      </div>
    </details>
  );
}
