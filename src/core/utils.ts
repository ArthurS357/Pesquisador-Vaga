import { Job } from "./types";
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
 * Resolve uma URL de tracking (redirect de e-mail) até a URL final.
 * Limita a 5 saltos para evitar loops infinitos.
 */
export async function resolveTrackingUrl(url: string, maxRedirects = 5): Promise<string> {
  let current = url;
  for (let i = 0; i < maxRedirects; i++) {
    try {
      const res = await fetchWithTimeout(current, { method: "HEAD", redirect: "manual" }, 5000);
      const location = res.headers.get("location");
      if ((res.status >= 301 && res.status <= 308) && location) {
        // Normaliza URL relativa para absoluta se necessário
        current = location.startsWith("http") ? location : new URL(location, current).href;
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
