// Seeds the DEVELOPMENT database (hrms_dev) with SYNTHETIC data: MVP test accounts, demo catalogs and demo profiles.
// Non-destructive: accounts and catalogs are insert-if-missing; demo profiles are added only when no profile exists.
import "dotenv/config";
import { db, disconnectDb } from "../src/lib/db";
import { isLoopbackHost } from "../src/lib/db-safety";
import { seedUsersAndCatalogs } from "./seed-data";
import { seedDemoProfiles } from "./seed-demo";

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  if (url.pathname !== "/hrms_dev" || !isLoopbackHost(url)) throw new Error("Seed runs only against the local hrms_dev database");
  const prisma = db();
  await seedUsersAndCatalogs(prisma, { includeTestOnlyUsers: false });
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
