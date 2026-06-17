export function JobCardSkeleton() {
  return (
    <div className="card sk-card" aria-hidden="true">
      <div className="card-head">
        <div className="badges">
          <span className="sk badge" style={{ width: 36 }}>&nbsp;</span>
          <span className="sk badge" style={{ width: 64 }}>&nbsp;</span>
        </div>
        <span className="sk sk-line" style={{ width: 48 }} />
      </div>
      <span className="sk sk-line" style={{ width: "80%", height: "1rem" }} />
      <span className="sk sk-line" style={{ width: "55%" }} />
      <span className="sk sk-line" style={{ width: "40%" }} />
      <div className="card-foot">
        <span className="sk sk-line" style={{ width: 60 }} />
        <span className="sk sk-line" style={{ width: 50 }} />
      </div>
    </div>
  );
}

export function JobGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid" role="status" aria-label="Carregando vagas">
      {Array.from({ length: count }, (_, i) => (
        <JobCardSkeleton key={i} />
      ))}
    </div>
  );
}
