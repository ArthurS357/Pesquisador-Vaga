import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  getCleanupCounts,
  executeCleanup,
  listSources,
} from "../../core/db-clean-core";

/**
 * As funções de db-clean-core recebem o PrismaClient por injeção, então
 * mockamos apenas os métodos usados (job.findMany / job.deleteMany).
 */
function makePrisma(): {
  prisma: PrismaClient;
  findMany: ReturnType<typeof vi.fn>;
  deleteMany: ReturnType<typeof vi.fn>;
} {
  const findMany = vi.fn();
  const deleteMany = vi.fn();
  const prisma = { job: { findMany, deleteMany } } as unknown as PrismaClient;
  return { prisma, findMany, deleteMany };
}

describe("getCleanupCounts", () => {
  it("retorna total deduplicado excluindo vagas com decisão humana", async () => {
    const { prisma, findMany } = makePrisma();
    // 1ª chamada: collectSafeIds (critério blocked) → 3 ids
    findMany.mockResolvedValueOnce([{ id: "a" }, { id: "b" }, { id: "c" }]);
    // 2ª chamada: excludeHumanOwned → "b" é APPROVED, deve ser ignorada
    findMany.mockResolvedValueOnce([{ id: "b" }]);

    const counts = await getCleanupCounts(prisma, { blocked: true });

    expect(counts.total).toBe(2); // a, c (b ignorada)
    expect(counts.skipped).toBe(1);
    expect(counts.criteria).toHaveLength(1);
    expect(counts.criteria[0]).toMatchObject({ key: "blocked", count: 3 });
  });

  it("retorna vazio quando nenhum critério é selecionado", async () => {
    const { prisma, findMany } = makePrisma();
    const counts = await getCleanupCounts(prisma, {});
    expect(counts).toEqual({ criteria: [], total: 0, skipped: 0 });
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("executeCleanup", () => {
  it("remove apenas vagas elegíveis e reporta contagem por critério", async () => {
    const { prisma, findMany, deleteMany } = makePrisma();
    // collectSafeIds
    findMany.mockResolvedValueOnce([{ id: "a" }, { id: "b" }]);
    // excludeHumanOwned → nenhuma humana
    findMany.mockResolvedValueOnce([]);
    // loop por critério → re-busca ids do critério
    findMany.mockResolvedValueOnce([{ id: "a" }, { id: "b" }]);
    deleteMany.mockResolvedValueOnce({ count: 2 });

    const result = await executeCleanup(prisma, { lowScore: true });

    expect(result.total).toBe(2);
    expect(result.skipped).toBe(0);
    expect(deleteMany).toHaveBeenCalledOnce();
  });

  it("não chama deleteMany quando tudo é protegido por decisão humana", async () => {
    const { prisma, findMany, deleteMany } = makePrisma();
    findMany.mockResolvedValueOnce([{ id: "a" }]);
    findMany.mockResolvedValueOnce([{ id: "a" }]); // "a" é humana

    const result = await executeCleanup(prisma, { blocked: true });

    expect(result.total).toBe(0);
    expect(result.skipped).toBe(1);
    expect(deleteMany).not.toHaveBeenCalled();
  });
});

describe("listSources", () => {
  it("retorna as fontes distintas do banco", async () => {
    const { prisma, findMany } = makePrisma();
    findMany.mockResolvedValueOnce([{ source: "greenhouse" }, { source: "lever" }]);

    const sources = await listSources(prisma);

    expect(sources).toEqual(["greenhouse", "lever"]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ distinct: ["source"] })
    );
  });
});
