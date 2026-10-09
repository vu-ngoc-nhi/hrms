import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getConfig } from "@/lib/config";

const globalForPrisma = globalThis as unknown as { __hrmsPrisma?: PrismaClient };

export function db(): PrismaClient {
  if (!globalForPrisma.__hrmsPrisma) {
    globalForPrisma.__hrmsPrisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: getConfig().databaseUrl }),
    });
  }
  return globalForPrisma.__hrmsPrisma;
}

export type Db = PrismaClient;
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export async function disconnectDb() {
  await globalForPrisma.__hrmsPrisma?.$disconnect();
  globalForPrisma.__hrmsPrisma = undefined;
}

// Extracts the PostgreSQL SQLSTATE and constraint name from Prisma/driver-adapter errors without reading data values.
export function pgErrorInfo(error: unknown): { sqlState?: string; constraint?: string; prismaCode?: string } {
  const out: { sqlState?: string; constraint?: string; prismaCode?: string } = {};
  const seen = new Set<unknown>();
  const visit = (e: unknown, depth: number) => {
    if (!e || typeof e !== "object" || seen.has(e) || depth > 6) return;
    seen.add(e);
    const o = e as Record<string, unknown>;
    if (typeof o.code === "string") {
      if (/^P\d{4}$/.test(o.code)) out.prismaCode ??= o.code;
      else if (/^[0-9A-Z]{5}$/.test(o.code)) out.sqlState ??= o.code;
    }
    if (typeof o.originalCode === "string") out.sqlState ??= o.originalCode;
    if (typeof o.constraint === "string") out.constraint ??= o.constraint;
    if (o.constraint && typeof o.constraint === "object") {
      const c = o.constraint as Record<string, unknown>;
      if (typeof c.index === "string") out.constraint ??= c.index;
      if (Array.isArray(c.fields)) out.constraint ??= undefined;
    }
    if (typeof o.message === "string" && !out.constraint) {
      const m = /constraint "([a-z0-9_]+)"/.exec(o.message);
      if (m) out.constraint = m[1];
    }
    for (const key of ["cause", "meta", "driverAdapterError"]) visit(o[key], depth + 1);
  };
  visit(error, 0);
  return out;
}
