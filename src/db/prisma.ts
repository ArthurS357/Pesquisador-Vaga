import { PrismaClient } from "@prisma/client";

// Padrão Singleton para evitar conexões exauridas em dev/HMR
const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
