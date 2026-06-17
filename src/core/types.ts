export interface Job {
  source: string;          // ex.: "greenhouse", "lever", "ashby"
  sourceId: string;        // id da vaga na fonte (para dedupe)
  company: string;
  title: string;
  location: string | null;
  description: string | null; // HTML
  applyUrl: string;
  updatedAt: Date | null;
}

export interface AdapterContext {
  since?: Date;
}

export interface JobAdapter {
  name: string;
  fetchJobs(ctx?: AdapterContext): Promise<Job[]>;
}
