// Seeds the DEVELOPMENT database (hrms_dev) with SYNTHETIC data: MVP test accounts, demo catalogs and demo profiles.
// Non-destructive: accounts and catalogs are insert-if-missing; demo profiles are added only when no profile exists.
// Accounts are created through the guarded access-administration routines (prerequisite: npm run access:provision-local).
import "dotenv/config";
import { db, disconnectDb } from "../src/lib/db";
import { isLoopbackHost } from "../src/lib/db-safety";
import { LOCAL_OPERATOR, operatorUrl } from "./access-provision-local";
import { seedAccounts, seedCatalogs } from "./seed-data";
import { seedDemoProfiles } from "./seed-demo";

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  if (url.pathname !== "/hrms_dev" || !isLoopbackHost(url)) throw new Error("Seed runs only against the local hrms_dev database");
  const prisma = db();
  // Accounts through the guarded access routines (run `npm run access:provision-local` first).
  await seedAccounts(process.env.ACCESS_ADMIN_DATABASE_URL ?? operatorUrl(process.env.DATABASE_URL!, LOCAL_OPERATOR.login), "local", { includeTestOnlyUsers: false });
  await seedCatalogs(prisma);
  if ((await prisma.person.count()) > 0) {
    console.log("Profiles already exist; demo profiles were not added.");
    return;
  }
  await seedDemoProfiles(prisma);
  console.log(`Seed complete: ${await prisma.person.count()} synthetic profiles.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
