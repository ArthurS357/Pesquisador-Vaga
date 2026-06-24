import { Job, JobAdapter, AdapterContext } from "../core/types";
import { sanitizeJobDescription } from "../core/sanitizer";
import { resilientFetch } from "../core/http-client";

const GH_BASE = "https://boards-api.greenhouse.io/v1/boards";

interface GhJob {
  id: number;
  title: string;
  updated_at?: string;
  absolute_url: string;
  location?: { name?: string };
  content?: string;
}

export function greenhouseAdapter(config: { id: string; name: string }): JobAdapter {
  return {
    name: `Greenhouse (${config.name})`,
    fetchJobs: async (ctx?: AdapterContext) => {
      const url = `${GH_BASE}/${config.id}/jobs?content=true`;
      const res = await resilientFetch(url);
      if (!res.ok) throw new Error(`Greenhouse[${config.id}]: HTTP ${res.status}`);
      const data = (await res.json()) as { jobs: GhJob[] };
      if (!data || !Array.isArray(data.jobs)) throw new Error(`Greenhouse[${config.id}]: Invalid payload`);
      
      return data.jobs.map((j): Job => ({
        source: "greenhouse",
        sourceId: String(j.id),
        company: config.name,
        title: j.title,
        location: j.location?.name ?? null,
        description: j.content ? sanitizeJobDescription(j.content) : null,
        applyUrl: j.absolute_url,
        updatedAt: j.updated_at ? new Date(j.updated_at) : null,
      }));
    }
  };
}
