import { fetchWithTimeout } from "./utils";

// Endpoint e modelo do Ollama local. Compartilhados por llm-judge (avaliação) e
// generator (carta). URL configurável por env para apontar a um host remoto/porta
// alternativa sem mexer no código. Default agora é a API de chat (/api/chat),
// que separa papéis system/user — base da blindagem contra prompt injection.
export const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434/api/chat";
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen3:8b";

/** Papéis suportados pela API de chat do Ollama. */
export type ChatRole = "system" | "user" | "assistant";

/** Uma mensagem no formato chat. */
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** Opções de inferência repassadas ao Ollama (`options` do payload). */
export interface OllamaOptions {
  temperature?: number;
  num_predict?: number;
}

export interface OllamaGenerateParams {
  /**
   * Mensagens no formato chat (preferido). O judge envia system+user para isolar
   * regras (trusted) do conteúdo da vaga (untrusted).
   */
  messages?: ChatMessage[];
  /**
   * Atalho de turno único: embrulhado em `[{ role: "user", content: prompt }]`.
   * Mantido p/ callers single-prompt (ex.: generator da carta) sem refator.
   */
  prompt?: string;
  /** `"json"` força structured output (usado pelo judge). Ausente na carta. */
  format?: "json";
  options?: OllamaOptions;
  timeoutMs: number;
  /** Prefixo de log para distinguir chamadas (ex.: "LLM", "generator"). */
  label: string;
}

/**
 * Chamada única ao `/api/chat` do Ollama (stream desligado). Retorna o texto cru
 * do campo `message.content`, ou `null` em qualquer falha (offline, timeout, HTTP
 * de erro, corpo vazio). Engole o erro com um warning logado — todos os callers
 * têm fallback. Parsing/validação do conteúdo fica por conta de quem chamou.
 */
export async function ollamaGenerate(params: OllamaGenerateParams): Promise<string | null> {
  const { messages, prompt, format, options, timeoutMs, label } = params;
  const tag = `[${label}]`;

  // Normaliza p/ chat: usa `messages` se vier; senão embrulha `prompt` num turno user.
  const chatMessages: ChatMessage[] =
    messages ?? (prompt !== undefined ? [{ role: "user", content: prompt }] : []);
  if (chatMessages.length === 0) {
    console.warn(`  ${tag} ❌ Nenhuma mensagem ou prompt fornecido.`);
    return null;
  }

  const approxChars = chatMessages.reduce((n, m) => n + m.content.length, 0);
  console.info(`  ${tag} 📤 Enviando ${chatMessages.length} mensagem(ns) para ${OLLAMA_MODEL} (~${approxChars} chars)...`);

  const t0 = Date.now();
  try {
    const res = await fetchWithTimeout(
      OLLAMA_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          messages: chatMessages,
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

    const body = (await res.json()) as { message?: { content?: string } };
    const text = body.message?.content?.trim();
    if (!text) {
      console.warn(`  ${tag} ❌ Resposta vazia (campo 'message.content' ausente).`);
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
