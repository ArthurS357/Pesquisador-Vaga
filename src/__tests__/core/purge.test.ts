import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { purgeInactiveJobs, PURGE_INACTIVE_DAYS_DEFAULT } from "../../core/purge";

/** purgeInactiveJobs recebe o PrismaClient por injeção — mockamos só os métodos usados. */
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

describe("purgeInactiveJobs", () => {
  it("remove vagas INACTIVE elegíveis e reporta contagem + IDs", async () => {
    const { prisma, findMany, deleteMany } = makePrisma();
    findMany.mockResolvedValueOnce([{ id: "a" }, { id: "b" }]);
    deleteMany.mockResolvedValueOnce({ count: 2 });

    const r = await purgeInactiveJobs(prisma, 30);

    expect(r.removed).toBe(2);
    expect(r.ids).toEqual(["a", "b"]);
    expect(r.days).toBe(30);
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["a", "b"] } } });
  });

  it("filtra por INACTIVE + idade + exclusão de status humano", async () => {
    const { prisma, findMany } = makePrisma();
    findMany.mockResolvedValueOnce([]);

    await purgeInactiveJobs(prisma, 15);

    const where = findMany.mock.calls[0]?.[0]?.where;
    expect(where).toMatchObject({ status: "INACTIVE" });
    expect(where.lastSeenAt.lt).toBeInstanceOf(Date);
    // Defesa em profundidade: nunca remove status de curadoria humana.
    expect(where.NOT.status.in).toContain("REJECTED");
    expect(where.NOT.status.in).toContain("APPLIED");
  });

  it("não chama deleteMany quando nada é elegível", async () => {
    const { prisma, findMany, deleteMany } = makePrisma();
    findMany.mockResolvedValueOnce([]);

    const r = await purgeInactiveJobs(prisma, 30);

    expect(r.removed).toBe(0);
    expect(r.ids).toEqual([]);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("sanitiza dias inválidos para o default", async () => {
    const { prisma, findMany } = makePrisma();
    findMany.mockResolvedValue([]);

    const r0 = await purgeInactiveJobs(prisma, 0);
    const rNaN = await purgeInactiveJobs(prisma, Number.NaN);

    expect(r0.days).toBe(PURGE_INACTIVE_DAYS_DEFAULT);
    expect(rNaN.days).toBe(PURGE_INACTIVE_DAYS_DEFAULT);
  });
});
