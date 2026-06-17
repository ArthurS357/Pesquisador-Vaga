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
      sources: [],
      lenses: [],
      min: 0,
      sort: "score",
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
      sources: ["greenhouse", "lever"],
      lenses: ["backend"],
      min: 60,
      sort: "recent",
      page: 3,
    });
  });

  it("sanitiza valores fora de faixa e inválidos", () => {
    const result = parseFilters({ min: "150", sort: "invalido", page: "-2" });
    expect(result.min).toBe(100); // clamp em 100
    expect(result.sort).toBe("score"); // sort desconhecido cai no default
    expect(result.page).toBe(1); // page < 1 vira 1
  });
});

describe("buildQuery", () => {
  const base: JobFilterState = {
    sources: [],
    lenses: [],
    min: 0,
    sort: "score",
    page: 1,
  };

  it("retorna '/' quando não há filtros ativos", () => {
    expect(buildQuery(base)).toBe("/");
  });

  it("serializa filtros não-default na query string", () => {
    expect(buildQuery(base, { sources: ["greenhouse"], min: 50, sort: "recent" })).toBe(
      "/?sources=greenhouse&min=50&sort=recent"
    );
  });

  it("omite page=1 e sort=score por serem defaults", () => {
    expect(buildQuery(base, { page: 1, sort: "score" })).toBe("/");
    expect(buildQuery(base, { page: 2 })).toBe("/?page=2");
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
