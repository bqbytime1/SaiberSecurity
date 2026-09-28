import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

/**
 * Cached in production too, not just in development.
 *
 * In development the reason is hot reloading: without this, every reload leaks another
 * client. In production on a long-running server it makes no difference, because the
 * module is evaluated once.
 *
 * On a serverless host it matters again for a different reason. Each route can be
 * bundled separately, so several copies of this module may be evaluated in one Lambda
 * container, and each `new PrismaClient()` opens its own pool. A handful of routes then
 * multiply into far more connections than the database allows, and queries start failing
 * under load rather than on the first request — the worst kind to diagnose.
 */
globalForPrisma.prisma = prisma;
