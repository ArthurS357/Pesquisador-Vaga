import { beforeEach, describe, expect, it, vi } from "vitest";
import { isForaDoBrasil, roleBlockReason, rankJob } from "../../core/ranker";
import type { Job } from "../../core/types";

// rankJob loga no console — silenciar mantém a saída do test runner limpa.
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

function makeJob(overrides: Partial<Job>): Job {
  return {
    source: "greenhouse",
    sourceId: "1",
    company: "Acme",
    title: "Software Engineer",
    location: null,
    description: null,
    applyUrl: "https://example.com/job/1",
    updatedAt: null,
    ...overrides,
  };
}

describe("isForaDoBrasil", () => {
  it("permite localização vazia, null ou em branco", () => {
    expect(isForaDoBrasil(null)).toBe(false);
    expect(isForaDoBrasil("")).toBe(false);
    expect(isForaDoBrasil("   ")).toBe(false);
  });

  it.each([
    "São Paulo, SP",
    "Rio de Janeiro",
    "Belo Horizonte, MG",
    "Curitiba, PR / Remoto",
    "Brasil",
    "Brazil",
    "Remote - Brazil",
    "Florianópolis",
  ])("trata localização brasileira como permitida: %s", (loc) => {
    expect(isForaDoBrasil(loc)).toBe(false);
  });

  it.each([
    "United States",
    "USA",
    "San Francisco, CA",
    "New York City",
    "London",
    "Berlin",
    "Portugal",
    "Buenos Aires",
    "Tokyo",
  ])("bloqueia localização estrangeira: %s", (loc) => {
    expect(isForaDoBrasil(loc)).toBe(true);
  });

  it("bloqueia prefixo ISO de país estrangeiro", () => {
    expect(isForaDoBrasil("IN-Bengaluru")).toBe(true);
    expect(isForaDoBrasil("MX-Remote")).toBe(true);
  });

  it("bloqueia 'AR-' (Argentina) após correção da allowlist de UFs", () => {
    // Regressão: A[CEMR] antigo deixava "AR" passar como se fosse UF brasileira.
    expect(isForaDoBrasil("AR-Buenos Aires")).toBe(true);
  });

  it("permite remoto/híbrido sem país fixo", () => {
    expect(isForaDoBrasil("Remote")).toBe(false);
    expect(isForaDoBrasil("Híbrido")).toBe(false);
    expect(isForaDoBrasil("Anywhere")).toBe(false);
  });
});

describe("roleBlockReason", () => {
  it.each([
    "Account Executive",
    "Account Manager",
    "Senior SDR",
    "BDR - Inbound",
    "Business Development Representative",
    "Sales Development Representative",
    "Sales Operations Analyst",
  ])("bloqueia função de vendas/não-técnica: %s", (title) => {
    expect(roleBlockReason(title)).not.toBeNull();
  });

  it.each([
    "Software Engineer",
    "Full Stack Developer",
    "Backend Engineer",
    "Frontend Developer",
    "Sales Engineer", // exclusão intencional: pré-venda técnico
    "Security Hunter", // exclusão intencional: InfoSec
  ])("NÃO bloqueia função técnica: %s", (title) => {
    expect(roleBlockReason(title)).toBeNull();
  });
});

describe("rankJob", () => {
  it("marca needsLlm=true para vaga técnica brasileira não-cacheada", () => {
    const result = rankJob(
      makeJob({ title: "Backend Engineer", location: "São Paulo, SP", description: "node, api, typescript" })
    );
    expect(result.needsLlm).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(25);
    expect(result.blockReason).toBeUndefined();
    expect(result.lens).toBe("backend");
  });

  it("retorna blockReason para vaga de vendas", () => {
    const result = rankJob(makeJob({ title: "Account Executive", location: "São Paulo, SP" }));
    expect(result.needsLlm).toBe(false);
    expect(result.score).toBe(0);
    expect(result.blockReason).toBe("sales/non-tech role");
  });

  it("bloqueia por senioridade incompatível", () => {
    const result = rankJob(makeJob({ title: "Senior Backend Engineer", location: "Remoto" }));
    expect(result.needsLlm).toBe(false);
    expect(result.reasons[0]).toContain("SENIORITY_BLOCK");
  });

  it("bloqueia por geografia (fora do Brasil)", () => {
    const result = rankJob(makeJob({ title: "Backend Engineer", location: "United States" }));
    expect(result.needsLlm).toBe(false);
    expect(result.reasons[0]).toContain("GEO_BLOCK");
  });

  it("aplica boost de +10 para vaga remota", () => {
    const remote = rankJob(makeJob({ title: "Backend Engineer", location: "Remoto", description: "remoto" }));
    expect(remote.score).toBeGreaterThan(50);
  });
});
