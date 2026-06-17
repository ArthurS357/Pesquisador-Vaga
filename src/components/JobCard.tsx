import type { ReactNode } from "react";
import type { Job } from "@prisma/client";
import {
  fmtScore, lensClass, lensLabel, relativeDate, scoreClass, sourceLabel,
} from "@/app/view";

export function JobCard({ job, actions }: { job: Job; actions?: ReactNode }) {
  const applied = relativeDate(job.lastSeenAt);
  return (
    <article className="card">
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

      {actions}

      <div className="card-foot">
        <span>{sourceLabel(job.source)}</span>
        <span className="status-pill badge">{job.status}</span>
      </div>
    </article>
  );
}
