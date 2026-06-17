import { Job, JobAdapter, AdapterContext } from "../core/types";
import { fetchWithTimeout, decodeHtml } from "../core/utils";

const LEVER_BASE = "https://api.lever.co/v0/postings";

interface LeverJob {
  id: string;
  text: string;
  updatedAt?: number;
  hostedUrl: string;
  categories?: { location?: string };
  descriptionPlain?: string;
  description?: string;
}

export function leverAdapter(config: { id: string; name: string }): JobAdapter {
  return {
    name: `Lever (${config.name})`,
    fetchJobs: async (ctx?: AdapterContext) => {
      const url = `${LEVER_BASE}/${config.id}?mode=json`;
      const res = await fetchWithTimeout(url, { headers: { "User-Agent": "job-engine/0.1" } });
      if (!res.ok) throw new Error(`Lever[${config.id}]: HTTP ${res.status}`);
      const data = (await res.json()) as LeverJob[];
      if (!Array.isArray(data)) throw new Error(`Lever[${config.id}]: Invalid payload`);
      
      return data.map((j): Job => ({
        source: "lever",
        sourceId: j.id,
        company: config.name,
        title: j.text,
        location: j.categories?.location ?? null,
        description: j.description ? decodeHtml(j.description) : (j.descriptionPlain || null),
        applyUrl: j.hostedUrl,
        updatedAt: j.updatedAt ? new Date(j.updatedAt) : null,
      }));
    }
  };
}
