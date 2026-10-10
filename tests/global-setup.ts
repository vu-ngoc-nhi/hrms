import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "../src/generated/prisma/client";
import { TEST_DATABASE_NAME } from "../src/lib/db-safety";
import { operatorUrl, provisionLocalAccess, TEST_OPERATORS } from "../scripts/access-provision-local";
import { resetTestDatabase } from "../scripts/reset-test-db";
import { seedAccounts, seedCatalogs } from "../scripts/seed-data";

// APP_ENV must already be 'test' in the invoking shell (`npm test` sets it). The .env file never overrides it.
export default async function setup() {
  loadEnv({ path: ".env", quiet: true });
  await resetTestDatabase(process.env);
  const appUrl = process.env.TEST_DATABASE_URL;
  if (!appUrl || new URL(appUrl).pathname !== `/${TEST_DATABASE_NAME}`) {
    throw new Error("TEST_DATABASE_URL must point to the hrms_test database");
  }
  // Access administration (C-89): test operator logins, environment 'test', accounts through the guarded routines.
  await provisionLocalAccess(process.env.TEST_MIGRATION_DATABASE_URL!, "test", Object.values(TEST_OPERATORS), process.env);
  await seedAccounts(operatorUrl(appUrl, TEST_OPERATORS.a.login), "test", { includeTestOnlyUsers: true });
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: appUrl }) });
  await seedCatalogs(prisma);
  await prisma.$disconnect();
}
