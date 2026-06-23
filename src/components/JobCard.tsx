"use client";

import { useOptimistic } from "react";
import type { Job } from "@prisma/client";
import {
  fmtScore, lensClass, lensLabel, relativeDate, scoreClass, sourceLabel,
} from "@/app/view";
import { JOB_STATUS } from "@/app/status";
import { JobActions } from "@/app/JobActions";

// Rótulo curto do status para o pill (vale tanto p/ status real quanto otimista).
const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "ACTIVE",
  APPROVED: "Aprovado",
  REJECTED: "Rejeitado",
  GENERATING: "Gerando",
  GENERATED: "GENERATED",
  APPLIED: "Aplicada",
  INACTIVE: "INACTIVE",
};

// Classe de opacidade do card por status otimista (instantâneo no clique).
const DIM_CLASS: Record<string, string> = {
  REJECTED: "card-rejecting",
  APPROVED: "card-approving",
  APPLIED: "card-approving", // reusa o esmaecimento 0.6 ao aplicar da fila
};
// Cor do pill de status por status otimista.
const PILL_CLASS: Record<string, string> = {
  REJECTED: "status-rejected",
  APPROVED: "status-approved",
  APPLIED: "status-approved", // badge verde "Aplicada" instantâneo
};

export function JobCard({ job }: { job: Job }) {
  // Status otimista: muda na hora do clique (Rejeitar), sem esperar o servidor.
  // Se a Server Action falhar (sem revalidatePath), o status base (job.status)
  // volta a valer e o useOptimistic reverte sozinho ao fim da transition.
  const [optimisticStatus, setOptimisticStatus] = useOptimistic(
    job.status,
    (_prev, next: string) => next,
  );

  const applied = relativeDate(job.lastSeenAt);
  const dimClass = DIM_CLASS[optimisticStatus] ?? "";
  const pillClass = PILL_CLASS[optimisticStatus] ?? "";
  // Trilho-accent à esquerda nas vagas já aprovadas (agrupamento visual da fila).
  const accentClass = optimisticStatus === JOB_STATUS.APPROVED ? "card-approved" : "";

  return (
    <article className={`card ${dimClass} ${accentClass}`}>
      <div className="card-head">
        <div className="badges">
          <span
            className={`badge score ${scoreClass(job.score)}`}
            title={job.score === null ? "Sem score" : `Score ${job.score}`}
          >
            {fmtScore(job.score)}
          </span>
          <span className={`badge ${lensClass(job.lens)}`}>{lensLabel(job.lens)}</span>
        </div>
        {applied && <span className="meta" title={job.lastSeenAt.toISOString()}>{applied}</span>}
      </div>

      <a
        className="title"
        href={job.applyUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Ver vaga ${job.title} na ${job.company} (abre em nova aba)`}
      >
        {job.title}
      </a>
      <div className="company">{job.company}</div>
      {job.location && <div className="meta">{job.location}</div>}

      {job.reasoning && (
        <details className="reasoning">
          <summary aria-label="Mostrar justificativa do score">Justificativa</summary>
          <p className="reasoning-body">{job.reasoning}</p>
        </details>
      )}

      <JobActions
        id={job.id}
        title={job.title}
        company={job.company}
        description={job.description}
        score={job.score}
        lens={job.lens}
        onOptimisticStatus={setOptimisticStatus}
      />

      <div className="card-foot">
        <span>{sourceLabel(job.source)}</span>
        <span className={`status-pill badge ${pillClass}`} role="status">
          {STATUS_LABEL[optimisticStatus] ?? optimisticStatus}
        </span>
      </div>
    </article>
  );
}
