import { createHash } from "crypto";

export function decodeHtml(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

export async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

/**
 * Hostname é loopback/privado/link-local? Bloqueia SSRF: redirects de e-mail
 * (input não-confiável) não podem nos fazer bater em 127.x, 10.x, 169.254.x
 * (metadata cloud), no Ollama local, etc.
 */
function isPrivateOrLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, ""); // tira colchetes IPv6
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "::1" || h === "::") return true;
  if (h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true; // link-local / ULA
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 169 && b === 254) return true; // link-local / metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

/**
 * Resolve uma URL de tracking (redirect de e-mail) até a URL final.
 * Limita a 5 saltos para evitar loops infinitos. Valida o alvo a cada salto
 * (e na URL inicial): scheme http(s) e host não-privado — barra SSRF.
 */
export async function resolveTrackingUrl(url: string, maxRedirects = 5): Promise<string> {
  let current = url;
  for (let i = 0; i < maxRedirects; i++) {
    let target: URL;
    try {
      target = new URL(current);
    } catch {
      break; // URL malformada — devolve o que tiver
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") break;
    if (isPrivateOrLocalHost(target.hostname)) break;

    try {
      const res = await fetchWithTimeout(target.href, { method: "HEAD", redirect: "manual" }, 5000);
      const location = res.headers.get("location");
      if ((res.status >= 301 && res.status <= 308) && location) {
        current = new URL(location, target).href; // normaliza relativo → absoluto
      } else {
        break; // Não é redirect, URL final encontrada
      }
    } catch {
      break; // Timeout ou erro de rede — retorna URL atual
    }
  }
  return current;
}

/** Gera hash determinístico (16 chars) para deduplicação de sourceId */
export function hashSourceId(...parts: string[]): string {
  const normalized = parts.map((p) => p.toLowerCase().trim()).join("|");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

/** Gera canonicalHash para dedupe cross-source (company + title) */
export function canonicalHash(company: string, title: string): string {
  const normalized = `${company.toLowerCase().trim()}|${title.toLowerCase().trim()}`;
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}
