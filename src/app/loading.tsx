import { JobGridSkeleton } from "@/components/JobCardSkeleton";

export default function Loading() {
  return (
    <main className="wrap">
      <header className="site-header">
        <h1>Job Engine — Curadoria</h1>
      </header>
      <JobGridSkeleton />
    </main>
  );
}
