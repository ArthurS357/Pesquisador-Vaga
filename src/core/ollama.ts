import { fetchWithTimeout } from "./utils";

// Endpoint e modelo do Ollama local. Compartilhados por llm-judge (avaliação) e
// generator (carta) — antes duplicados em ambos. URL configurável por env para
// apontar a um host remoto/porta alternativa sem mexer no código.
export const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434/api/generate";
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen3:8b";

/** Opções de inferência repassadas ao Ollama (`options` do payload). */
export interface OllamaOptions {
  temperature?: number;
  num_predict?: number;
}

export interface OllamaGenerateParams {
  prompt: string;
  /** `"json"` força structured output (usado pelo judge). Ausente na carta. */
  format?: "json";
  options?: OllamaOptions;
  timeoutMs: number;
  /** Prefixo de log para distinguir chamadas (ex.: "LLM", "generator"). */
  label: string;
}

/**
 * Chamada única ao `/api/generate` do Ollama (stream desligado). Retorna o texto
 * cru do campo `response`, ou `null` em qualquer falha (offline, timeout, HTTP de
 * erro, corpo vazio). Engole o erro com um warning logado — todos os callers têm
 * fallback. Parsing/validação do conteúdo fica por conta de quem chamou.
 */
export async function ollamaGenerate(params: OllamaGenerateParams): Promise<string | null> {
  const { prompt, format, options, timeoutMs, label } = params;
  const tag = `[${label}]`;
  console.info(`  ${tag} 📤 Enviando prompt para ${OLLAMA_MODEL} (~${prompt.length} chars)...`);

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
          stream: false,
          ...(format ? { format } : {}),
          ...(options ? { options } : {}),
        }),
      },
      timeoutMs,
    );

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.info(`  ${tag} 📥 Resposta recebida em ${elapsed}s (HTTP ${res.status})`);

    if (!res.ok) {
      console.warn(`  ${tag} ❌ Ollama retornou HTTP ${res.status}.`);
      return null;
    }

    const body = (await res.json()) as { response?: string };
    const text = body.response?.trim();
    if (!text) {
      console.warn(`  ${tag} ❌ Resposta vazia (campo 'response' ausente).`);
      return null;
    }
    return text;
  } catch (err) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof Error && err.name === "AbortError") {
      console.warn(`  ${tag} ❌ Timeout após ${elapsed}s (limite: ${timeoutMs / 1000}s).`);
    } else if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
      console.warn(`  ${tag} ❌ Ollama offline (conexão recusada).`);
    } else {
      console.warn(`  ${tag} ❌ Erro de rede: ${msg}.`);
    }
    return null;
  }
}
