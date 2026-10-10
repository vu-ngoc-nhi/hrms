// Guarded access-administration command (C-89): `npm run access -- <command> --env <environment> ...`.
// Connects with ACCESS_ADMIN_DATABASE_URL (the operator's personal login); see docs/production/access-administration-runbook.md.
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { runAccessCli } from "../src/modules/identity/access-admin-cli";

const prompt = process.stdin.isTTY
  ? async (question: string) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await rl.question(question);
      } finally {
        rl.close();
      }
    }
  : undefined;

runAccessCli(process.argv.slice(2), { out: (l) => console.log(l), err: (l) => console.error(l), prompt }).then((code) => {
  process.exitCode = code;
});
