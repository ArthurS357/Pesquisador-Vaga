"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { buildQuery, type JobFilterState } from "@/app/view";
import { JOB_STATUS } from "@/app/status";

const TABS: { key: string | null; label: string; countKey: string }[] = [
  { key: null, label: "Todas", countKey: "all" },
  { key: JOB_STATUS.ACTIVE, label: "Novas", countKey: JOB_STATUS.ACTIVE },
  { key: JOB_STATUS.APPROVED, label: "Aprovadas", countKey: JOB_STATUS.APPROVED },
];

/**
 * Abas de status da fila (faceted). Cada aba é um facet de `status` na URL;
 * o badge mostra a contagem ao vivo (vinda do server). useTransition mantém a
 * troca instantânea sem travar a UI enquanto o RSC re-renderiza.
 */
export function StatusTabs({
  current,
  counts,
}: {
  current: JobFilterState;
  counts: Record<string, number>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function go(status: string | null): void {
    const url = buildQuery(current, { status, page: 1 });
    startTransition(() => router.replace(url, { scroll: false }));
  }

  return (
    <div className={`tabs${pending ? " tabs-pending" : ""}`} role="tablist" aria-label="Filtrar a fila por status">
      {TABS.map((t) => {
        const active = current.status === t.key;
        return (
          <button
            key={t.label}
            type="button"
            role="tab"
            aria-selected={active}
            className={`tab${active ? " tab-active" : ""}`}
            onClick={() => go(t.key)}
            disabled={pending}
          >
            <span className="tab-label">{t.label}</span>
            <span className="tab-count">{counts[t.countKey] ?? 0}</span>
          </button>
        );
      })}
    </div>
  );
}
