import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isInfoJobsJunkTitle,
  infoJobsJobId,
  extractInfoJobsCompany,
  parseGenericJobEmail,
  parseLinkedInJobAlert,
  looksLikeJobEmail,
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

describe("parseLinkedInJobAlert", () => {
  const date = new Date("2026-06-17T02:38:36Z");

  // Estrutura real do e-mail de alerta do LinkedIn: cada vaga é um <table> com
  // um anchor-logo vazio + anchor-bloco (com " · ") + anchor-título, e um <p>
  // "Empresa · Localização". Todos os anchors de uma vaga têm o mesmo href.
  const linkedInHtml = `
    <body>
      <h2>Arthur: foi criado seu alerta de vaga para Engenheiro De Software</h2>
      <table>
        <tr><td>
          <a href="https://www.linkedin.com/comm/jobs/view/4416927632?alertAction=markasviewed"></a>
          <a href="https://www.linkedin.com/comm/jobs/view/4416927632?alertAction=markasviewed">Engenheiro(a) de Software Junior ou Pleno | BTG Empresas BTG Pactual · São Paulo, São Paulo, Brasil Recrutando agora</a>
          <a href="https://www.linkedin.com/comm/jobs/view/4416927632?alertAction=markasviewed">Engenheiro(a) de Software Junior ou Pleno | BTG Empresas</a>
          <p>BTG Pactual · São Paulo, São Paulo, Brasil</p>
          <p class="job-card-flavor__detail">Recrutando agora</p>
        </td></tr>
      </table>
      <table>
        <tr><td>
          <a href="https://www.linkedin.com/comm/jobs/view/4425333091?alertAction=markasviewed">Software Engineer - Mercado Envios</a>
          <p>Mercado Livre · São Paulo, Brasil</p>
        </td></tr>
      </table>
      <a href="https://www.linkedin.com/comm/jobs/search/">Veja todas as vagas</a>
    </body>
  `;

  it("extrai vagas com empresa e localização separadas", () => {
    const jobs = parseLinkedInJobAlert(linkedInHtml, date);

    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      source: "linkedin-email",
      title: "Engenheiro(a) de Software Junior ou Pleno | BTG Empresas",
      company: "BTG Pactual",
      location: "São Paulo, São Paulo, Brasil",
      description: null,
      updatedAt: date,
    });
    expect(jobs[0].applyUrl).toContain("/jobs/view/4416927632");
    expect(jobs[1]).toMatchObject({
      title: "Software Engineer - Mercado Envios",
      company: "Mercado Livre",
      location: "São Paulo, Brasil",
    });
  });

  it("deduplica a mesma vaga aparecendo em múltiplos anchors", () => {
    // O anchor-bloco (com " · ") e o anchor-título compartilham o mesmo id —
    // a vaga só pode ser contada uma vez.
    const jobs = parseLinkedInJobAlert(linkedInHtml, date);
    const btgCount = jobs.filter((j) => j.title.includes("BTG Empresas")).length;
    expect(btgCount).toBe(1);
  });

  it("ignora CTAs e cabeçalho do e-mail (Veja todas as vagas, sem /jobs/view/)", () => {
    const jobs = parseLinkedInJobAlert(linkedInHtml, date);
    expect(jobs.some((j) => /veja todas|alerta de vaga/i.test(j.title))).toBe(false);
  });

  it("usa location null quando o card não traz ' · '", () => {
    const html = `
      <table><tr><td>
        <a href="https://www.linkedin.com/comm/jobs/view/999">Dev Backend</a>
      </td></tr></table>`;
    const jobs = parseLinkedInJobAlert(html, date);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].location).toBeNull();
    expect(jobs[0].company).toBe("LinkedIn");
  });

  it("gera sourceId determinístico a partir de company+title+location", () => {
    const a = parseLinkedInJobAlert(linkedInHtml, date);
    const b = parseLinkedInJobAlert(linkedInHtml, new Date("2026-07-01T00:00:00Z"));
    // Mesma vaga em e-mails diferentes (datas/tracking diferentes) → mesmo sourceId.
    expect(a[0].sourceId).toBe(b[0].sourceId);
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

  it("ignora e-mail sem sinal de vaga (sem keyword no assunto, sem link de vaga)", () => {
    const jobs = parseGenericJobEmail(
      '"Banco XPTO [ XPTO ]" <noreply@xpto.com>',
      "Sua fatura fechou",
      '<a href="https://xpto.com/fatura">ver fatura</a>',
      date
    );
    expect(jobs).toEqual([]);
  });

  it("aceita e-mail com link de vaga mesmo sem keyword no assunto", () => {
    const jobs = parseGenericJobEmail(
      '"Recrutadora [ Acme ]" <rh@acme.com>',
      "Oi Sabino, dá uma olhada nisso",
      '<a href="https://boards.greenhouse.io/acme/jobs/123">candidate-se</a>',
      date
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0].company).toBe("Acme");
  });
});

describe("looksLikeJobEmail", () => {
  it("true quando assunto tem keyword de vaga", () => {
    expect(looksLikeJobEmail("Nova vaga de Desenvolvedor", "<p>oi</p>")).toBe(true);
  });

  it("true quando corpo tem link de vaga, assunto neutro", () => {
    expect(
      looksLikeJobEmail("Novidades", '<a href="https://x.gupy.io/jobs/9">x</a>')
    ).toBe(true);
  });

  it("false quando assunto neutro e corpo sem link de vaga", () => {
    expect(looksLikeJobEmail("Sua fatura", '<a href="https://x.com/fatura">f</a>')).toBe(false);
  });
});
