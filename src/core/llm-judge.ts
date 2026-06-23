import { loadProfile } from "../utils/profile";
import { ollamaGenerate } from "./ollama";

// qwen3:8b em GPU (RX 7600, contexto 8192 → 100% VRAM) responde em ~3-5s.
// Timeout curto detecta falha de GPU/servidor cedo (em CPU levaria 60-120s).
const LLM_TIMEOUT_MS = 30_000;

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

  const response = await ollamaGenerate({
    prompt,
    format: "json",
    options: { temperature: 0.1, num_predict: 512 },
    timeoutMs: LLM_TIMEOUT_MS,
    label: "LLM",
  });
  if (!response) {
    console.warn(`  [LLM] ↩ Sem resposta do Ollama. Usando fallback heurístico.`);
    return null;
  }

  console.info(`  [LLM] 📦 Corpo (${response.length} chars): ${response.slice(0, 120)}`);

  const result = safeParseJson(response);
  if (!result) {
    console.warn(`  [LLM] ❌ Falha ao parsear JSON: ${response.slice(0, 200)}`);
    return null;
  }

  console.info(`  [LLM] ✅ score=${result.score}, lens=${result.lens} — ${result.reasoning.slice(0, 80)}`);
  return result;
}
