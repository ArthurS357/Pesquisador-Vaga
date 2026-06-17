import { readFileSync } from "fs";
import { join } from "path";
import { decodeHtml, fetchWithTimeout } from "./utils";

const OLLAMA_URL = "http://localhost:11434/api/generate";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen3:8b";
const PROFILE_PATH = join(process.cwd(), "perfil-mestre.md");

/** Dados mínimos da vaga necessários para gerar a carta. */
export interface CoverLetterInput {
  company: string;
  title: string;
  lens: string | null;
  description: string | null; // HTML cru vindo do adapter, pode ser null
  applyUrl: string;
  sourceId: string;
  score: number | null;
}

export interface CoverLetterArtifact {
  filename: string; // relativo à raiz do projeto
  content: string; // markdown final (frontmatter + corpo)
}

function loadProfile(): string {
  try {
    return readFileSync(PROFILE_PATH, "utf-8");
  } catch {
    return "Candidato generalista buscando oportunidades em tecnologia.";
  }
}

/** HTML → texto plano enxuto para caber na prompt. */
function htmlToText(html: string): string {
  return decodeHtml(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}

function slugify(s: string): string {
  // NFD separa letra+acento; o filtro [^a-z0-9] abaixo descarta a marca combinante.
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Caminho determinístico do artefato de uma vaga. Mesmo cálculo no gerador
 * (escrita) e no painel (exibição) — evita coluna nova no banco.
 */
export function coverLetterFilename(company: string, sourceId: string): string {
  return join("output", "cover-letters", `${slugify(company)}-${sourceId}.md`);
}

function buildPrompt(input: CoverLetterInput, profile: string): string {
  const desc = input.description ? htmlToText(input.description) : null;
  return `You are the candidate (Sabino) writing a cover letter. You MUST follow these rules strictly.

## Candidate Profile
${profile}

## Job
Company: ${input.company}
Title: ${input.title}
Area (lens): ${input.lens ?? "unclassified"}
Description: ${desc ?? "(no description — focus on the job title and company)"}

## STRICT WRITING RULES (all must be followed)
1. TONE: Highly concise, direct, and pragmatic. No corporate fluff, no buzzwords, no long introductions.
2. LENGTH: Maximum 3 short paragraphs, ~180-220 words total. Quality over quantity.
3. STACK PRIORITY: Directly connect job requirements to the candidate's CORE stack: Node.js, React, TypeScript (primary). Python if relevant to the role. Do not pad with unrelated skills.
4. NO CLICHÉS: Forbidden phrases: "apaixonado por", "sempre sonhei", "pró-ativo", "você será minha", "excited to", "passionate about", "team player". If any appear, rewrite.
5. NO FABRICATION: Only mention skills, projects, and experiences present in the candidate profile above.
6. LANGUAGE: Write entirely in Brazilian Portuguese (pt-BR).
7. FORMAT: Output ONLY the letter body — no subject line, no address header, no closing signature.`;
}

/**
 * Chama o Ollama local para redigir a carta. Retorna o texto ou null
 * (Ollama offline / resposta vazia). Mesmo isolamento do llm-judge.
 */
export async function generateCoverLetter(input: CoverLetterInput): Promise<string | null> {
  const prompt = buildPrompt(input, loadProfile());
  try {
    const res = await fetchWithTimeout(
      OLLAMA_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
      },
      60_000, // carta é mais longa que o judge — 60s
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { response?: string };
    const text = body.response?.trim();
    return text && text.length > 0 ? text : null;
  } catch {
    return null; // ECONNREFUSED / timeout — tratado pelo chamador
  }
}

/** Monta o markdown final (frontmatter + corpo) para gravar em disco. */
export function buildArtifact(input: CoverLetterInput, body: string): CoverLetterArtifact {
  const filename = coverLetterFilename(input.company, input.sourceId);
  const frontmatter = [
    "---",
    `empresa: ${JSON.stringify(input.company)}`,
    `vaga: ${JSON.stringify(input.title)}`,
    `lens: ${JSON.stringify(input.lens ?? "")}`,
    `score: ${input.score ?? ""}`,
    `apply_url: ${JSON.stringify(input.applyUrl)}`,
    `gerado_em: ${new Date().toISOString()}`,
    "---",
    "",
  ].join("\n");
  return { filename, content: `${frontmatter}${body}\n` };
}
