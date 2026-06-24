import { describe, expect, it } from "vitest";
import {
  parseFilters,
  buildQuery,
  scoreClass,
  relativeDate,
  lensClass,
  lensLabel,
  type JobFilterState,
} from "../../app/view";

describe("parseFilters", () => {
  it("aplica defaults para params vazios", () => {
    expect(parseFilters({})).toEqual({
      q: "",
      sources: [],
      lenses: [],
      min: 0,
      sort: "score",
      status: null,
      page: 1,
    });
  });

  it("parseia listas, score e ordenação", () => {
    const result = parseFilters({
      sources: "greenhouse,lever",
      lenses: "backend",
      min: "60",
      sort: "recent",
      page: "3",
    });
    expect(result).toEqual({
      q: "",
      sources: ["greenhouse", "lever"],
      lenses: ["backend"],
      min: 60,
      sort: "recent",
      status: null,
      page: 3,
    });
  });

  it("sanitiza valores fora de faixa e inválidos", () => {
    const result = parseFilters({ min: "150", sort: "invalido", page: "-2" });
    expect(result.min).toBe(100); // clamp em 100
    expect(result.sort).toBe("score"); // sort desconhecido cai no default
    expect(result.page).toBe(1); // page < 1 vira 1
  });

  it("parseia busca textual (q) e facet de status válido", () => {
    const r = parseFilters({ q: "  Backend Dev  ", status: "APPROVED" });
    expect(r.q).toBe("Backend Dev");
    expect(r.status).toBe("APPROVED");
  });

  it("ignora status fora da fila (só ACTIVE/APPROVED)", () => {
    expect(parseFilters({ status: "REJECTED" }).status).toBeNull();
    expect(parseFilters({ status: "lixo" }).status).toBeNull();
  });
});

describe("buildQuery", () => {
  const base: JobFilterState = {
    q: "",
    sources: [],
    lenses: [],
    min: 0,
    sort: "score",
    status: null,
    page: 1,
  };

  it("preserva view=ops mesmo sem filtros ativos (anti-amnésia de URL)", () => {
    expect(buildQuery(base)).toBe("/?view=ops");
  });

  it("serializa filtros não-default na query string (com view=ops na frente)", () => {
    expect(buildQuery(base, { sources: ["greenhouse"], min: 50, sort: "recent" })).toBe(
      "/?view=ops&sources=greenhouse&min=50&sort=recent"
    );
  });

  it("omite page=1 e sort=score por serem defaults, mantendo view=ops", () => {
    expect(buildQuery(base, { page: 1, sort: "score" })).toBe("/?view=ops");
    expect(buildQuery(base, { page: 2 })).toBe("/?view=ops&page=2");
  });

  it("serializa q e status preservando view=ops", () => {
    expect(buildQuery(base, { q: "node", status: "ACTIVE" })).toBe("/?view=ops&q=node&status=ACTIVE");
  });
});

describe("scoreClass", () => {
  it("retorna a classe correta por faixa de score", () => {
    expect(scoreClass(70)).toBe("score-high");
    expect(scoreClass(100)).toBe("score-high");
    expect(scoreClass(40)).toBe("score-mid");
    expect(scoreClass(69)).toBe("score-mid");
    expect(scoreClass(39)).toBe("score-low");
    expect(scoreClass(null)).toBe("score-low");
  });
});

describe("relativeDate", () => {
  it("formata datas relativas em pt-BR (granularidade de dias)", () => {
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
    expect(relativeDate(null)).toBe("");
    expect(relativeDate(new Date())).toBe("hoje");
    expect(relativeDate(daysAgo(1))).toBe("ontem");
    expect(relativeDate(daysAgo(5))).toBe("há 5 dias");
    expect(relativeDate(daysAgo(45))).toBe("há 1 mês");
  });
});

describe("lensClass / lensLabel", () => {
  it("normaliza lens conhecidas e desconhecidas", () => {
    expect(lensClass("backend")).toBe("lens-backend");
    expect(lensClass("dados")).toBe("lens-data"); // alias dados → data
    expect(lensClass(null)).toBe("lens-generic");
    expect(lensClass("xpto")).toBe("lens-generic");
  });

  it("rotula lens com label amigável", () => {
    expect(lensLabel("backend")).toBe("Backend");
    expect(lensLabel(null)).toBe("Geral");
    expect(lensLabel("desconhecida")).toBe("desconhecida");
  });
});
