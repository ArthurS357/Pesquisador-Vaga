import { Job } from "./types";

export interface JobScore {
  score: number;         // 0-100
  lens: string;          // "backend" | "frontend" | "devops" | "data" | "generic"
  reasons: string[];     // Debug
  needsLlm: boolean;     // true se score >= 25 e deve ir para Estágio 2
  blockReason?: string;  // definido quando bloqueado explicitamente (não persiste no DB)
}

const LENS_KEYWORDS: Record<string, string[]> = {
  backend:  ["backend", "node", "python", "java", "golang", "api", "microservice", "django", "fastapi", "rails"],
  frontend: ["frontend", "react", "vue", "angular", "next.js", "typescript", "css", "ui", "ux"],
  devops:   ["devops", "infra", "kubernetes", "k8s", "terraform", "aws", "gcp", "azure", "ci/cd", "sre"],
  data:     ["data", "analytics", "sql", "spark", "kafka", "dbt", "etl", "bi", "machine learning", "ml"],
};

// "senior"/"staff"/"pleno" removidos: bloqueados em Estágio 1 pelo SENIORITY_BLOCK_REGEX
const BOOST_KEYWORDS = ["remoto", "remote", "pj"];
// Termos júnior/estágio são o target — sem penalidade
const PENALTY_KEYWORDS: string[] = [];

/**
 * Bloqueia títulos com senioridade incompatível com foco Júnior/Estágio.
 * Testado apenas contra job.title — descriptions mencionam requisitos sênior sem ser a vaga.
 */
const SENIORITY_BLOCK_REGEX = /\b(senior|sr|pleno|pl|lead|staff|principal|head|manager|supervisor|diretor|vp)\b/i;

/**
 * Padrões de função não-técnica que nunca devem alcançar o LLM.
 * Cada regex é independente e case-insensitive para facilitar manutenção e testes.
 *
 * Exclusões intencionais (não bloqueadas):
 *   "Sales Engineer"    → função técnica (pré-venda técnico)
 *   "Security Hunter"   → InfoSec / threat hunting
 *   "Hunter" isolado    → ambíguo; bloqueado apenas com prefixo comercial
 */
const ROLE_BLOCK_PATTERNS: RegExp[] = [
  /\baccount\s+executive\b/i,
  /\baccount\s+manager\b/i,
  /\baccount\s+(?:development|hunter|grower)\b/i,
  /\bbusiness\s+development\b/i,
  /\bcommercial\s+hunter\b/i,
  /\bcross[-\s]?border\b/i,
  /\bsdr\b/i,
  /\bbdr\b/i,
  /\bsales\s+(?:development|representative|rep|operations|specialist|analyst|coordinator|executive|enablement)\b/i,
  /\b(?:smb|enterprise|mid[-\s]?market)\s+grower\b/i,
];

/** Brasil/LatAm allowlist. "Remote" isolado é sinal neutro — deixa passar para o LLM. */
const BRASIL_LATAM_REGEX =
  /\b(brasil|brazil|latam|lat[- ]?am|s[aã]o paulo|rio de janeiro|remoto|remote)\b/i;

/**
 * Override bloqueante: regiões que sempre bloqueiam mesmo que "Remote" apareça no texto.
 * "US-Remote" indica escopo americano; APAC/DACH/Europe são regiões não-BR.
 */
const GEO_OVERRIDE_REGEX =
  /\b(bangalore|dach|europe|european\s+union|apac|asia[-\s]pacific|us[-\s]remote|uk[-\s]remote|eu[-\s]remote|emea[-\s]remote)\b/i;

/**
 * Blocklist geral aplicada após override e allowlist não decidirem.
 * \b evita falsos positivos ("USP", "house", "Cloudera").
 */
const GEO_BLOCK_REGEX =
  /\b(US|USA|United\s+States|U\.S\.A?\.?|UK|United\s+Kingdom|Canada|Londres|London|Dublin|Berlin|Paris|Amsterdam|Singapore|Sydney|Australia|New\s+Zealand|India|Japan|China|Korea|France|Germany|Spain|EMEA|APAC|DACH|AUNZ|Iberia|NAMER|Remote\s*[-–]\s*(US|UK|EU|EMEA|APAC|Canada|India)|Europe|European\s+Union|Asia|Asia[-\s]Pacific)\b/i;

const LOW_RELEVANCE_THRESHOLD = 25;

function isSeniorityBlocked(title: string): string | null {
  const match = title.match(SENIORITY_BLOCK_REGEX);
  return match ? match[0] : null;
}

/** Retorna o trecho que acionou o bloqueio de função, ou null se permitido. */
export function roleBlockReason(title: string): string | null {
  for (const pattern of ROLE_BLOCK_PATTERNS) {
    const match = title.match(pattern);
    if (match) return match[0];
  }
  return null;
}

/** Returns true if text signals Brasil / LatAm origin. Case-insensitive. */
export function isBrasilOrLatam(text: string): boolean {
  return BRASIL_LATAM_REGEX.test(text);
}

/**
 * Allowlist-first geo filter applied to `title + location`.
 *
 * Priority:
 * 1. Empty location → pass-through (LLM decides — may be global remote).
 * 2. Override block (APAC, DACH, Europe, Bangalore, US-Remote) → always block.
 * 3. Brasil / LatAm allowlist → pass-through.
 * 4. General international blocklist → block.
 * 5. No match → pass-through.
 *
 * Returns match string if blocked, null if allowed.
 */
function geoBlockReason(title: string, location: string | null | undefined): string | null {
  if (!location?.trim()) return null;

  const textToCheck = `${title} ${location}`.trim();

  const overrideMatch = textToCheck.match(GEO_OVERRIDE_REGEX);
  if (overrideMatch) return overrideMatch[0];

  if (isBrasilOrLatam(textToCheck)) return null;

  const blockMatch = textToCheck.match(GEO_BLOCK_REGEX);
  return blockMatch ? blockMatch[0] : null;
}

/**
 * Estágio 1 — Heurística local por palavras-chave + filtro geográfico.
 * Retorna `needsLlm: true` se score >= 25 (candidato a Estágio 2).
 */
export function rankJob(job: Job): JobScore {
  console.log(`🔍 Ranker processando: "${job.title}" @ ${job.company}`);
  const roleMatch = roleBlockReason(job.title);
  if (roleMatch) {
    return {
      score: 0,
      lens: "generic",
      reasons: [`ROLE_BLOCK: "${roleMatch}" em "${job.title}"`],
      needsLlm: false,
      blockReason: "sales/non-tech role",
    };
  }

  const seniorityMatch = isSeniorityBlocked(job.title);
  if (seniorityMatch) {
    return {
      score: 0,
      lens: "generic",
      reasons: [`SENIORITY_BLOCK: "${seniorityMatch}" em "${job.title}"`],
      needsLlm: false,
    };
  }

  const geoMatch = geoBlockReason(job.title, job.location);
  if (geoMatch) {
    return {
      score: 0,
      lens: "generic",
      reasons: [`GEO_BLOCK: "${geoMatch}" em "${job.title} | ${job.location ?? ""}"`],
      needsLlm: false,
    };
  }

  const text = `${job.title} ${job.company} ${job.description ?? ""}`.toLowerCase();
  const reasons: string[] = [];
  let score = 50;

  let lens = "generic";
  let maxLensScore = 0;
  for (const [l, keywords] of Object.entries(LENS_KEYWORDS)) {
    const hits = keywords.filter((kw) => text.includes(kw));
    if (hits.length > maxLensScore) {
      maxLensScore = hits.length;
      lens = l;
      if (hits.length > 0) reasons.push(`Lens "${l}": ${hits.join(", ")}`);
    }
  }

  for (const kw of BOOST_KEYWORDS) {
    if (text.includes(kw)) {
      score += 10;
      reasons.push(`+10 boost: "${kw}"`);
    }
  }

  for (const kw of PENALTY_KEYWORDS) {
    if (text.includes(kw)) {
      score -= 20;
      reasons.push(`-20 penalidade: "${kw}"`);
    }
  }

  score = Math.max(0, Math.min(100, score));
  const needsLlm = score >= LOW_RELEVANCE_THRESHOLD;
  return { score, lens, reasons, needsLlm };
}
