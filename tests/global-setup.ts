import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "../src/generated/prisma/client";
import { TEST_DATABASE_NAME } from "../src/lib/db-safety";
import { resetTestDatabase } from "../scripts/reset-test-db";
import { seedUsersAndCatalogs } from "../scripts/seed-data";

// APP_ENV must already be 'test' in the invoking shell (`npm test` sets it). The .env file never overrides it.
export default async function setup() {
  loadEnv({ path: ".env", quiet: true });
  await resetTestDatabase(process.env);
  const appUrl = process.env.TEST_DATABASE_URL;
  if (!appUrl || new URL(appUrl).pathname !== `/${TEST_DATABASE_NAME}`) {
    throw new Error("TEST_DATABASE_URL must point to the hrms_test database");
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: appUrl }) });
  await seedUsersAndCatalogs(prisma, { includeTestOnlyUsers: true });
  await prisma.$disconnect();
}
