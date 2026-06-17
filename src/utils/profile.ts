/**
 * profile.ts — Carregamento único do perfil-mestre.md, compartilhado pelo
 * LLM judge e pelo gerador de cartas.
 *
 * Lazy + cacheado: a leitura de disco só acontece na primeira chamada de
 * loadProfile(), não no import do módulo. Isso mantém os imports livres de
 * side-effects de I/O e permite testar quem depende do perfil sem tocar o FS.
 */

import { readFileSync } from "fs";
import { join } from "path";

const PROFILE_PATH = join(process.cwd(), "perfil-mestre.md");
const FALLBACK_PROFILE = "Candidato generalista buscando oportunidades em tecnologia.";

let cachedProfile: string | null = null;

/** Lê (uma vez) e retorna o perfil-mestre. Cai no fallback se o arquivo faltar. */
export function loadProfile(): string {
  if (cachedProfile !== null) return cachedProfile;
  try {
    cachedProfile = readFileSync(PROFILE_PATH, "utf-8");
  } catch {
    console.warn("[profile] perfil-mestre.md não encontrado. Usando perfil vazio.");
    cachedProfile = FALLBACK_PROFILE;
  }
  return cachedProfile;
}

/** Limpa o cache em memória. Uso restrito a testes. */
export function _resetProfileCache(): void {
  cachedProfile = null;
}
