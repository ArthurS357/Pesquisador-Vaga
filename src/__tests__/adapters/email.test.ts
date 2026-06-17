import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isInfoJobsJunkTitle,
  infoJobsJobId,
  extractInfoJobsCompany,
  parseGenericJobEmail,
} from "../../adapters/email";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("isInfoJobsJunkTitle", () => {
  it.each([
    "Candidatar-me",
    "CANDIDATAR-ME",
    "Cancelar o recebimento de e-mails",
    "Precisa de ajuda?",
    "ab", // < 3 chars
  ])("classifica como lixo: %s", (title) => {
    expect(isInfoJobsJunkTitle(title)).toBe(true);
  });

  it.each([
    "Desenvolvedor Java Pleno",
    "11429998 - Técnico de Suporte",
  ])("aceita título de vaga real: %s", (title) => {
    expect(isInfoJobsJunkTitle(title)).toBe(false);
  });

  it("trata bloco de localização/salário sem código como lixo", () => {
    expect(isInfoJobsJunkTitle("R$ 3.000 CLT Presencial")).toBe(true);
  });
});

describe("infoJobsJobId", () => {
  it("extrai id do padrão __<id>.aspx", () => {
    expect(
      infoJobsJobId("https://www.infojobs.com.br/vaga-de-dev__11716514.aspx")
    ).toBe("11716514");
  });

  it("extrai id numérico longo seguido de .aspx", () => {
    expect(infoJobsJobId("https://www.infojobs.com.br/vaga-de-dev-11716514.aspx")).toBe(
      "11716514"
    );
  });

  it("retorna null quando não há id", () => {
    expect(infoJobsJobId("https://www.infojobs.com.br/sobre")).toBeNull();
  });
});

describe("extractInfoJobsCompany", () => {
  it("extrai o nome real de 'A empresa X está selecionando'", () => {
    expect(
      extractInfoJobsCompany("A empresa Acme Tecnologia está selecionando candidatos")
    ).toBe("Acme Tecnologia");
  });

  it("usa fallback de primeiro segmento quando não há padrão conhecido", () => {
    expect(extractInfoJobsCompany("Tech Corp | São Paulo")).toBe("Tech Corp");
  });
});

describe("parseGenericJobEmail", () => {
  const date = new Date("2026-01-01T12:00:00Z");

  it("extrai título limpo, empresa e URL de um e-mail genérico", () => {
    const jobs = parseGenericJobEmail(
      '"Recrutadora [ Zallpy ]" <vagas@zallpy.com>',
      "Vaga: Desenvolvedor Node.js",
      '<a href="https://carreiras.zallpy.com/vaga/123">Candidatar</a> descrição da vaga',
      date
    );

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      source: "email-generic",
      title: "Desenvolvedor Node.js",
      company: "Zallpy",
      applyUrl: "https://carreiras.zallpy.com/vaga/123",
    });
  });

  it("retorna vazio quando não há título extraível do assunto", () => {
    const jobs = parseGenericJobEmail('"X" <x@y.com>', "", "<p>corpo</p>", date);
    expect(jobs).toEqual([]);
  });

  it("retorna vazio quando não há empresa no remetente", () => {
    const jobs = parseGenericJobEmail("<no-name@y.com>", "Vaga: Dev", "<p>x</p>", date);
    expect(jobs).toEqual([]);
  });
});
