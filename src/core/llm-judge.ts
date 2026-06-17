import { fetchWithTimeout } from "./utils";
import { loadProfile } from "../utils/profile";

const OLLAMA_URL = "http://localhost:11434/api/generate";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen3:8b";
// qwen3:8b em CPU (sem GPU no Windows) pode levar 60–120s por inferência
const LLM_TIMEOUT_MS = 120_000;

export interface LlmJudgeResult {
  score: number;   // 0-100
  lens: string;    // "backend" | "frontend" | "devops" | "data" | "generic"
  reasoning: string;
  fromCache?: boolean;
}

// Trunca o perfil para ~2000 chars para não explodir o contexto do LLM
const MAX_PROFILE_CHARS = 2000;

function buildPrompt(title: string, company: string, description: string): string {
  // loadProfile() é lazy + cacheado — leitura só na 1ª inferência da run.
  const profileSnippet = loadProfile().slice(0, MAX_PROFILE_CHARS);
  return `You are a strict job-fit evaluator. Your task is to evaluate how well the job below fits the candidate profile. Respond ONLY with a single valid JSON object — no markdown, no explanation outside the JSON.

## Candidate Profile (Sabino)
Primary stack: Node.js, React, TypeScript. Secondary: Python.
Role target: Software Engineering / Backend / Frontend / Full Stack / AppSec / Security Audit.

Full profile context:
${profileSnippet}

## Job to Evaluate
Title: ${title}
Company: ${company}
Description: ${description.slice(0, 1200)}

## CRITICAL RULES (MUST follow — these override everything else)
1. ROLE TYPE CHECK FIRST: Identify the PRIMARY FUNCTION of this job — what the person will DO every day.
   Assign score < 20 (mandatory, no exceptions) if the primary function falls into ANY of these blocked categories:
   - Sales: Account Executive, Account Manager, Business Development, Sales Manager, Revenue, GTM
   - Marketing: Campaign Manager, Growth Marketing, Demand Gen, Brand, SEO/SEM Manager, Paid Media
   - HR / People: Recruiter, People Partner, People Consultant, HR Business Partner, Talent
   - Finance / Accounting: Accountant, Controller, FP&A, Accounts Receivable, Payroll, Treasury Analyst
   - Legal / Compliance / Privacy: Counsel, Legal, Compliance Officer, Privacy Fellow, Regulatory, AML
   - Product Management: Product Manager, Product Lead (without "Engineer"), Product Owner
   - Operations (non-engineering): Program Manager, Operations Manager, Office Manager, Coordinator, Administrative
   - Internal Audit / Risk (non-technical): Internal Audit Lead, Risk Manager, Internal Controls
   IMPORTANT: The presence of technical tools, APIs, SQL, or data in the job description does NOT change the classification. Judge by what the person's primary daily work is, not by what tools they interact with tangentially.
2. SCORE MEANING: 0-19 = blocked (wrong role type), 20-49 = weak fit, 50-74 = moderate fit, 75-100 = strong fit (only for direct engineering/technical roles: Software Engineer, Backend, Frontend, Full Stack, DevOps, SRE, Data Engineer, Security Engineer, AppSec).
3. LENS: Use "sales" for commercial/GTM roles, "generic" for unclear/mixed roles, or one of: backend, frontend, devops, data, appsec.
4. Do NOT fabricate technical relevance. If unsure whether a role is technical, default to score < 30.

## Response Format (ONLY this JSON, nothing else)
{"score": <0-100>, "lens": "<backend|frontend|devops|data|appsec|sales|generic>", "reasoning": "<max 2 sentences>"}

Respond only with valid JSON. No markdown, no preamble. /no_think`;
}

function safeParseJson(raw: string): LlmJudgeResult | null {
  // Remove blocos markdown se o LLM desobedecer o formato
  const cleaned = raw.replace(/```json|```/gi, "").trim();
  // Extrai o primeiro objeto JSON encontrado na string
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[0]) as Partial<LlmJudgeResult>;
    const score = typeof parsed.score === "number" ? Math.max(0, Math.min(100, parsed.score)) : null;
    const lens = typeof parsed.lens === "string" ? parsed.lens : "generic";
    const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : "";
    if (score === null) return null;
    return { score, lens, reasoning };
  } catch {
    return null;
  }
}

export async function judgeWithLlm(
  title: string,
  company: string,
  description: string
): Promise<LlmJudgeResult | null> {
  const prompt = buildPrompt(title, company, description);
  console.info(`  [LLM] 📤 Enviando prompt para ${OLLAMA_MODEL} (~${prompt.length} chars)...`);

  const t0 = Date.now();
  try {
    const res = await fetchWithTimeout(
      OLLAMA_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt,
          format: "json",
          stream: false,
          options: { temperature: 0.1, num_predict: 512 },
        }),
      },
      LLM_TIMEOUT_MS
    );

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.info(`  [LLM] 📥 Resposta recebida em ${elapsed}s (HTTP ${res.status})`);

    if (!res.ok) {
      console.warn(`  [LLM] ❌ Ollama retornou HTTP ${res.status}. Usando fallback heurístico.`);
      return null;
    }

    const body = (await res.json()) as { response?: string };
    if (!body.response) {
      console.warn(`  [LLM] ❌ Resposta vazia (campo 'response' ausente). Usando fallback heurístico.`);
      return null;
    }

    console.info(`  [LLM] 📦 Corpo (${body.response.length} chars): ${body.response.slice(0, 120)}`);

    const result = safeParseJson(body.response);
    if (!result) {
      console.warn(`  [LLM] ❌ Falha ao parsear JSON: ${body.response.slice(0, 200)}`);
      return null;
    }

    console.info(`  [LLM] ✅ score=${result.score}, lens=${result.lens} — ${result.reasoning.slice(0, 80)}`);
    return result;
  } catch (err) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof Error && err.name === "AbortError") {
      console.warn(`  [LLM] ❌ Timeout após ${elapsed}s (limite: ${LLM_TIMEOUT_MS / 1000}s). Usando fallback heurístico.`);
    } else if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
      console.warn(`  [LLM] ❌ Ollama offline (conexão recusada). Usando fallback heurístico.`);
    } else {
      console.warn(`  [LLM] ❌ Erro de rede: ${msg}. Usando fallback heurístico.`);
    }
    return null;
  }
}
