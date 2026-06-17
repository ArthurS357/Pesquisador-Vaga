/**
 * job-engine — passo 1: fatia vertical (1 fonte real, ponta a ponta)
 *
 * Rodar:
 *   npm i -D tsx typescript
 *   npx tsx job-engine-step1.ts
 *
 * Node 18+ (fetch nativo). Sem dependências de runtime.
 */

// ─────────────────────────────────────────────────────────────
// 1. Schema normalizado — a "moeda comum" de todo adapter
// ─────────────────────────────────────────────────────────────
export interface Job {
  source: string;          // ex.: "greenhouse"
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

// ─────────────────────────────────────────────────────────────
// 2. Adapter Greenhouse — bate na API pública, mapeia pro schema
// ─────────────────────────────────────────────────────────────
const GH_BASE = "https://boards-api.greenhouse.io/v1/boards";

interface GhJob {
  id: number;
  title: string;
  updated_at?: string;
  absolute_url: string;
  location?: { name?: string };
  content?: string;
}

function decodeHtml(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

export function greenhouseAdapter(config: { id: string; name: string }): JobAdapter {
  return {
    name: `Greenhouse (${config.name})`,
    fetchJobs: async (ctx?: AdapterContext) => {
      const url = `${GH_BASE}/${config.id}/jobs?content=true`;
      const res = await fetchWithTimeout(url, { headers: { "User-Agent": "job-engine/0.1" } });
      if (!res.ok) throw new Error(`Greenhouse[${config.id}]: HTTP ${res.status}`);
      const data = (await res.json()) as { jobs: GhJob[] };
      return data.jobs.map((j): Job => ({
        source: "greenhouse",
        sourceId: String(j.id),
        company: config.name,
        title: j.title,
        location: j.location?.name ?? null,
        description: j.content ? decodeHtml(j.content) : null,
        applyUrl: j.absolute_url,
        updatedAt: j.updated_at ? new Date(j.updated_at) : null,
      }));
    }
  };
}

// ─────────────────────────────────────────────────────────────
// 3. Coletor — roda N adapters em paralelo e deduplica
// ─────────────────────────────────────────────────────────────
async function collect(adapters: JobAdapter[], concurrency = 3): Promise<Job[]> {
  const all: Job[] = [];
  for (let i = 0; i < adapters.length; i += concurrency) {
    const chunk = adapters.slice(i, i + concurrency);
    const results = await Promise.allSettled(chunk.map((a) => a.fetchJobs()));
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      const adapter = chunk[j];
      if (r.status === "fulfilled") {
        all.push(...r.value);
      } else {
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
        console.error(`  ! adapter falhou [${adapter.name}]:`, msg);
      }
    }
  }
  // dedupe por (source + sourceId)
  const seen = new Set<string>();
  return all.filter((j) => {
    const key = `${j.source}:${j.sourceId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─────────────────────────────────────────────────────────────
// 4. Runner — troque os tokens pelas empresas que te interessam
//    (o token é o que aparece em boards.greenhouse.io/<token>)
// ─────────────────────────────────────────────────────────────
const BOARDS = [
  { id: "stripe", name: "Stripe" },
  { id: "figma", name: "Figma" },
  { id: "gitlab", name: "GitLab" }
];

async function main() {
  const adapters = BOARDS.map(greenhouseAdapter);
  const jobs = await collect(adapters);

  console.log(`\n✓ ${jobs.length} vagas coletadas e deduplicadas\n`);
  for (const j of jobs.slice(0, 15)) {
    console.log(`• [${j.company}] ${j.title}`);
    console.log(`    ${j.location ?? "local não informado"} — ${j.applyUrl}`);
  }
  if (jobs.length > 15) console.log(`  ... e mais ${jobs.length - 15}`);
}

main().catch((e) => {
  console.error("Falha geral:", e);
  process.exit(1);
});
