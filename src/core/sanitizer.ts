/**
 * Sanitização de descrição na BORDA DE INGESTÃO (Blueprint D do Dossiê).
 *
 * Roda nos adaptadores ANTES de a descrição tocar o banco ou a IA. Quatro passos:
 *  1. Strip de tags  — remove <script>/<style> inteiros + qualquer markup cru.
 *  2. Decode SEGURO  — desfaz só entidades inertes (&amp; &quot; &#39; &nbsp;).
 *  3. Cap de contexto — corta em MAX_DESCRIPTION_CHARS (RAM + tokens da IA).
 *  4. Fencing        — embrulha em ```[UNTRUSTED_INGEST]``` p/ o LLM saber a fronteira.
 *
 * ⚠️ INVARIANTE DE SEGURANÇA: `&lt;`/`&gt;` NUNCA são des-escapados. Um
 * `&lt;script&gt;` codificado na fonte permanece texto inerte — jamais vira
 * `<script>` executável. Por isso NÃO usamos `decodeHtml` (utils) aqui: ela
 * decodifica `&lt;`/`&gt;` e reabriria o vetor.
 */

/** Teto de caracteres da descrição após limpeza. Protege RAM e janela da IA. */
export const MAX_DESCRIPTION_CHARS = 6000;

/** Marcadores de fronteira do bloco não-confiável (consumidos pelo prompt da IA). */
const FENCE_OPEN = "```[UNTRUSTED_INGEST]";
const FENCE_CLOSE = "```";

/** Remove blocos <script>/<style> (conteúdo incluso) e qualquer outra tag crua. */
function stripTags(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ") // bloco + corpo
    .replace(/<\/?[a-z][^>]*>/gi, " ") // tags restantes → espaço (preserva separação)
    .replace(/<!--[\s\S]*?-->/g, " "); // comentários HTML
}

/**
 * Decodifica APENAS entidades inertes. Ordem importa: `&amp;` por último pra não
 * re-expandir (`&amp;lt;` → `&lt;`, e para aí — `&lt;` segue literal, seguro).
 * `&lt;`/`&gt;` ficam DE FORA de propósito (ver invariante no topo).
 */
function decodeSafeEntities(s: string): string {
  return s
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");
}

/** Colapsa whitespace excessivo: múltiplos espaços/quebras viram 1 espaço. */
function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Limpa e blinda uma descrição de vaga vinda de fonte não-confiável (HTML de ATS).
 * Retorna "" quando, depois da limpeza, não sobra texto — o adaptador mapeia p/ null.
 */
export function sanitizeJobDescription(raw: string): string {
  const cleaned = collapseWhitespace(decodeSafeEntities(stripTags(raw)));
  if (!cleaned) return "";

  const capped =
    cleaned.length > MAX_DESCRIPTION_CHARS ? cleaned.slice(0, MAX_DESCRIPTION_CHARS).trimEnd() : cleaned;

  return `\n${FENCE_OPEN}\n${capped}\n${FENCE_CLOSE}\n`;
}
