import { Job } from "./types";

export interface JobScore {
  score: number;         // 0-100
  lens: string;          // "backend" | "frontend" | "devops" | "data" | "generic"
  reasons: string[];     // Debug
  needsLlm: boolean;     // true se score >= 25 e deve ir para Estágio 2
  blockReason?: string;  // definido quando bloqueado explicitamente (não persiste no DB)
}

// Matching por substring (text.includes) — heurística do Estágio 1, refinada
// pelo LLM no Estágio 2. Mantém a mesma taxonomia de lens que src/app/view.ts.
const LENS_KEYWORDS: Record<string, string[]> = {
  backend:   ["backend", "node", "python", "java", "golang", "api", "microservice", "django", "fastapi", "rails"],
  frontend:  ["frontend", "react", "vue", "angular", "next.js", "typescript", "css", "ui", "ux"],
  fullstack: ["fullstack", "full-stack", "full stack"],
  devops:    ["devops", "infra", "kubernetes", "k8s", "terraform", "aws", "gcp", "azure", "ci/cd", "sre"],
  data:      ["data", "analytics", "sql", "spark", "kafka", "dbt", "etl", "bi", "machine learning", "ml"],
  mobile:    ["mobile", "android", "swift", "kotlin", "flutter", "react native", "react-native", "ios"],
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

// ── Filtro geográfico (Estágio 1) ──────────────────────────────────────────
// Regexes compilados uma vez. Aplicados a `job.location` por `isForaDoBrasil`.

/** Remoto / híbrido / distribuído: sem localização fixa ⇒ permitir. */
const REMOTO_HIBRIDO_REGEX =
  /\b(remot[oe]|remote|home[- ]?office|híbrido|hibrido|hybrid|flexível|flexivel|anywhere|distributed)\b/i;

/** Siglas de estados brasileiros. */
// A[CLMP] = AC, AL, AM, AP (os 4 estados com inicial A) — antes era A[CEMR],
// que incluía AE/AR inexistentes e deixava "AR" (Argentina) vazar pela allowlist.
const BR_ESTADO_REGEX =
  /\b(A[CLMP]|BA|CE|DF|ES|GO|MA|M[GST]|P[ABEIR]|R[JNORS]|S[CEPR]|TO)\b/i;

/** Cidades brasileiras conhecidas. */
const BR_CIDADE_REGEX =
  /\b(São Paulo|Rio de Janeiro|Belo Horizonte|Brasília|Curitiba|Porto Alegre|Recife|Fortaleza|Salvador|Florianópolis|Campinas|Manaus|Vitória|Goiânia|Belém)\b/i;

/** "Brasil" / "Brazil" / "BR". */
const BR_PAIS_REGEX = /\b(Brasil|Brazil|BR)\b/i;

/** Países estrangeiros comuns (inglês + português). */
const PAIS_ESTRANGEIRO_REGEX =
  /\b(United States|USA|U\.?S\.?A?\.?|Canada|Australia|Japan|Singapore|Germany|Deutschland|Spain|España|France|UK|United Kingdom|England|Ireland|Italy|Italia|Portugal|Mexico|México|Argentina|Chile|Colombia|Peru|Perú|India|Índia|Poland|Polônia|Romania|Romênia|Netherlands|Holanda|Países Baixos|Sweden|Suécia|Norway|Noruega|Denmark|Dinamarca|Finland|Finlândia|Switzerland|Suíça|Austria|Belgium|Bélgica|New Zealand|Nova Zelândia|South Africa|África do Sul|UAE|Emirados Árabes|Dubai|Israel|China|Hong Kong|Taiwan|South Korea|Coreia do Sul|Korea|Thailand|Tailândia|Vietnam|Vietnã|Malaysia|Malásia|Indonesia|Indonésia|Philippines|Filipinas|Luxembourg|Luxemburgo|Hungary|Hungria|Greece|Grécia|Turkey|Turquia|Russia|Rússia|Nigeria|Nigéria|Kenya|Quênia|Egypt|Egito|Saudi Arabia|Arábia Saudita|Qatar|Catar|Pakistan|Paquistão|Bangladesh|Ukraine|Ucrânia|Czech Republic|Czechia)\b/i;

/**
 * Cidades estrangeiras comuns (inclui abreviações tipo NYC e CDMX).
 * Trailing (?![a-zA-Z]) em vez de \b final — cobre cidades com último char
 * acentuado (ex: Bogotá) onde \b falha por á ser não-ASCII (\W para o motor JS).
 */
const CIDADE_ESTRANGEIRA_REGEX =
  /\b(New York City|NYC|San Francisco|Chicago|Seattle|Austin|Denver|Los Angeles|Boston|Miami|London|Paris|Berlin|Tokyo|Sydney|Toronto|Dublin|Amsterdam|Stockholm|Singapore|Dubai|Hong Kong|Shanghai|Seoul|Madrid|Barcelona|Lisbon|Warsaw|Bucharest|Bengaluru|Bangalore|Hyderabad|Mumbai|Delhi|Pune|Chennai|Kolkata|CDMX|Buenos Aires|Santiago|Lima|Bogotá|Bogota|Brussels|Bruxelas|Zurich|Zürich|Geneva|Oslo|Helsinki|Copenhagen|Vienna|Prague|Budapest|Auckland|Wellington|Manila|Jakarta|Bangkok|Hanoi|Kuala Lumpur|Taipei)(?![a-zA-Z])/i;

/** Sigla de estado dos EUA após cidade ("San Francisco, CA"). Case-sensitive. */
const US_STATE_SUFFIX_REGEX = /\b[A-Z]{2}(,|$)/;

/**
 * Prefixo ISO de país seguido de hífen (ex: "IN-Bengaluru", "MX-Remote").
 * A allowlist BR roda antes — "ES-" (Espírito Santo) e "MA-" (Maranhão) já são
 * liberados por BR_ESTADO_REGEX antes de chegarmos aqui.
 */
const ISO_COUNTRY_PREFIX_REGEX =
  /\b(US|CA|MX|GB|UK|DE|FR|ES|IT|PT|IE|NL|BE|LU|CH|AT|SE|NO|DK|FI|PL|CZ|SK|HU|RO|BG|GR|TR|RU|UA|BY|IN|PK|BD|LK|NP|CN|JP|KR|TW|HK|SG|TH|VN|PH|MY|ID|AU|NZ|AR|CL|CO|PE|UY|PY|BO|EC|VE|ZA|NG|KE|EG|AE|SA|QA|IL|JO|MA)-/i;

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

/**
 * Bloqueio geográfico. `true` ⇒ a vaga é claramente de fora do Brasil.
 * Função pura, sem efeitos colaterais — exportada para testabilidade.
 *
 * Prioridade (a ordem importa):
 *   1. null / undefined / vazio          → false  (sem localização ⇒ permitir)
 *   2. Sinal brasileiro (UF/cidade/BR)    → false  (allowlist tem prioridade)
 *   3. Sinal estrangeiro (país/cidade/UF) → true   (bloquear)
 *   4. Remoto / híbrido                   → false  (sem localização fixa ⇒ permitir)
 *   5. Sem correspondência                → false  (permitir por padrão)
 *
 * A allowlist BR roda antes do bloqueio para que casos mistos como
 * "São Paulo, SP / Remoto" e siglas que colidem (PA, RO, MS…) fiquem liberados;
 * o custo aceito é deixar passar raras vagas dos EUA cuja UF coincide com a BR.
 * O bloqueio estrangeiro roda antes do remoto para barrar "US-Remote".
 */
export function isForaDoBrasil(location: string | null): boolean {
  const loc = location?.trim();
  if (!loc) return false;

  if (BR_ESTADO_REGEX.test(loc) || BR_CIDADE_REGEX.test(loc) || BR_PAIS_REGEX.test(loc)) {
    return false;
  }

  if (
    PAIS_ESTRANGEIRO_REGEX.test(loc) ||
    CIDADE_ESTRANGEIRA_REGEX.test(loc) ||
    US_STATE_SUFFIX_REGEX.test(loc) ||
    ISO_COUNTRY_PREFIX_REGEX.test(loc)
  ) {
    return true;
  }

  if (REMOTO_HIBRIDO_REGEX.test(loc)) return false;

  return false;
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

  if (isForaDoBrasil(job.location)) {
    console.log(`  🌍 [FORA_DO_BRASIL] "${job.title}" @ ${job.company} (${job.location})`);
    return {
      score: 0,
      lens: "generic",
      reasons: [`GEO_BLOCK: fora do Brasil — "${job.location ?? ""}"`],
      needsLlm: false,
    };
  }

  // Passou no geo. Vagas sem localização fixa (vazio/remoto/híbrido) são permitidas.
  const loc = job.location?.trim();
  if (!loc || REMOTO_HIBRIDO_REGEX.test(loc)) {
    console.log(`  🏠 [REMOTO/HÍBRIDO] "${job.title}" @ ${job.company} — sem localização fixa, permitindo`);
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
