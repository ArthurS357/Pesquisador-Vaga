import { QUEUE_STATUSES } from "./status";

export type SortKey = "score" | "recent" | "company" | "title";

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "score", label: "Maior score" },
  { value: "recent", label: "Mais recentes" },
  { value: "company", label: "Empresa A–Z" },
  { value: "title", label: "Título A–Z" },
];

const SORT_KEYS = SORT_OPTIONS.map((o) => o.value);

export const PAGE_SIZE = 50;

export interface JobFilterState {
  sources: string[];
  lenses: string[];
  min: number;
  sort: SortKey;
  page: number;
}

export type RawParams = Record<string, string | string[] | undefined>;

function pick(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function toArr(v: string | string[] | undefined): string[] {
  const raw = pick(v);
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function parseFilters(sp: RawParams): JobFilterState {
  const minRaw = Number(pick(sp.min));
  const min = Number.isFinite(minRaw) ? Math.min(100, Math.max(0, minRaw)) : 0;
  const sortRaw = pick(sp.sort) as SortKey | undefined;
  const sort: SortKey = sortRaw && SORT_KEYS.includes(sortRaw) ? sortRaw : "score";
  const pageRaw = Number(pick(sp.page));
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
  return { sources: toArr(sp.sources), lenses: toArr(sp.lenses), min, sort, page };
}

export function buildQuery(s: JobFilterState, override: Partial<JobFilterState> = {}): string {
  const m: JobFilterState = { ...s, ...override };
  const p = new URLSearchParams();
  if (m.sources.length) p.set("sources", m.sources.join(","));
  if (m.lenses.length) p.set("lenses", m.lenses.join(","));
  if (m.min > 0) p.set("min", String(m.min));
  if (m.sort !== "score") p.set("sort", m.sort);
  if (m.page > 1) p.set("page", String(m.page));
  const qs = p.toString();
  return qs ? `/?${qs}` : "/";
}

export const QUEUE_STATUS_LIST = [...QUEUE_STATUSES];

const LENS_LABELS: Record<string, string> = {
  frontend: "Frontend", backend: "Backend", fullstack: "Fullstack",
  devops: "DevOps", data: "Dados", dados: "Dados", mobile: "Mobile", generic: "Geral",
};
const KNOWN_LENSES = ["frontend", "backend", "fullstack", "devops", "data", "mobile"];

export function lensClass(lens: string | null): string {
  const k = (lens ?? "generic").toLowerCase();
  const norm = k === "dados" ? "data" : k;
  return KNOWN_LENSES.includes(norm) ? `lens-${norm}` : "lens-generic";
}

export function lensLabel(lens: string | null): string {
  if (!lens) return "Geral";
  return LENS_LABELS[lens.toLowerCase()] ?? lens;
}

export function scoreClass(score: number | null): string {
  if (score === null) return "score-low";
  if (score >= 70) return "score-high";
  if (score >= 40) return "score-mid";
  return "score-low";
}

export function fmtScore(score: number | null): string {
  return score === null ? "—" : String(Math.round(score));
}

const SOURCE_LABELS: Record<string, string> = {
  "greenhouse": "Greenhouse", "lever": "Lever", "ashby": "Ashby",
  "linkedin-email": "LinkedIn", "gupy-email": "Gupy",
  "infojobs-email": "InfoJobs", "vagascom-email": "Vagas.com",
  "email-generic": "E-mail",
};
export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

export function relativeDate(d: Date | null): string {
  if (!d) return "";
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "hoje";
  if (days === 1) return "ontem";
  if (days < 30) return `há ${days} dias`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? "há 1 mês" : `há ${months} meses`;
  const years = Math.floor(days / 365);
  return years === 1 ? "há 1 ano" : `há ${years} anos`;
}
