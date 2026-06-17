import { Job, JobAdapter, AdapterContext } from "../core/types";
import { fetchWithTimeout, decodeHtml } from "../core/utils";

const ASHBY_BASE = "https://api.ashbyhq.com/posting-api/job-board";

interface AshbyJob {
  id: string;
  title: string;
  updatedAt?: string;
  jobUrl: string;
  location?: string;
  descriptionHtml?: string;
}

export function ashbyAdapter(config: { id: string; name: string }): JobAdapter {
  return {
    name: `Ashby (${config.name})`,
    fetchJobs: async (ctx?: AdapterContext) => {
      const url = `${ASHBY_BASE}/${config.id}`;
      const res = await fetchWithTimeout(url, { headers: { "User-Agent": "job-engine/0.1" } });
      if (!res.ok) throw new Error(`Ashby[${config.id}]: HTTP ${res.status}`);
      const data = (await res.json()) as { jobs: AshbyJob[] };
      if (!data || !Array.isArray(data.jobs)) throw new Error(`Ashby[${config.id}]: Invalid payload`);
      
      return data.jobs.map((j): Job => ({
        source: "ashby",
        sourceId: String(j.id),
        company: config.name,
        title: j.title,
        location: j.location ?? null,
        description: j.descriptionHtml ? decodeHtml(j.descriptionHtml) : null,
        applyUrl: j.jobUrl,
        updatedAt: j.updatedAt ? new Date(j.updatedAt) : null,
      }));
    }
  };
}
