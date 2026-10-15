# Eme People — Deployment and Migration Runbook (TEMPLATE / DRAFT)

- Date: 2026-10-12. Gate A6. **Template only — closes nothing.** Hosting-specific steps are marked `[IT-xx]` and are completed once IT answers `it-input-request-01.md`. A6 closes only after a successful staging rehearsal (`staging-rehearsal-checklist.md`).
- Rules: forward-only migrations; a committed migration is never edited (CLAUDE.md); no down migrations; production migrations are **attended**, run outside working hours with notice (C-91); no ad-hoc SQL for HR data; restore only as a last resort with Management + System Owner approval. No recurring CAB: one approval line per release.

## 1. Roles

| Role | Does |
|---|---|
| Technical Owner (PV-26) | Builds, deploys, runs migrations, records the release |
| Migration authority (IT-09) | Holds the schema-owner login in the secret store; may be the Technical Owner |
| System Owner (HR) | Approves releases with business impact; receives the maintenance notice |
| Management | Approves a production **restore** (with the System Owner) |

## 2. Environments and configuration

| | Staging | Production |
|---|---|---|
| URL | `[IT-04]` | `[IT-04]` |
| Database | `[IT-01/IT-03]`, dedicated (IT-07) | `[IT-01/IT-03]`, dedicated |
| `APP_ENV` / `NODE_ENV` | `production` / `production` (the app accepts nothing else under `next start`) | same |
| Entra values | non-production registration (E1–E5) | production registration |
| Secrets | `[IT-05]` — separate per environment, never shared, never development values | same |

The **application** environment contains only: `APP_ENV`, `NODE_ENV`, `DATABASE_URL` (`hrms_app` login), `AUTH_MODE=entra`, `ENTRA_TENANT_ID`, `ENTRA_API_CLIENT_ID`, `ENTRA_API_SCOPE`, `IDEMPOTENCY_HMAC_KEY`, `COMPANY_EMAIL_DOMAINS` (+ `NEXT_PUBLIC_ENTRA_*` once browser sign-in exists). The app **refuses to start** if the owner/migration, test or operator URLs or the test-issuer variables are present (`security-headers.md` §3).

## 3. Build the artifact (once per release)

1. Release commit on `main`; full quality gate green (typecheck, lint, `npm test`, integrity baseline, `npm run build`).
2. Tag it (`git tag -a vX.Y.Z`); tags are never moved.
3. On the build machine: Node.js 24, clean checkout of the tag, then
   ```bash
   npm ci
   npm run db:generate
   npm run build
   ```
4. Artifact = `[IT-01: container image / archive]` containing the build output and dependencies. Record: tag, commit, `package-lock.json` hash, artifact id. *To verify in the staging rehearsal:* whether development dependencies can be pruned after the build (`next.config.ts` is loaded at start).
5. The **same artifact** goes to staging, then production. Never rebuild for production.

## 4. Before a production release

| Check | Done |
|---|---|
| Staging deployed with this artifact; migrations and smoke passed (§5–§7) | ☐ |
| Release notes list the migrations; each is additive / compatible with the previous app version (so rollback by redeploy works) | ☐ |
| If a migration is included: maintenance window outside working hours agreed; HR notified `[n]` days before (C-91) | ☐ |
| Approval recorded (who, when, which tag) | ☐ |
| Backup restore-tested at least once on this platform (A5) | ☐ |

## 5. Run migrations (attended)

On the approved operator / migration machine (`[IT-11]`), never from the application host's runtime environment:

1. Clean checkout of the **same tag**, `npm ci`. **No `.env` file** in this checkout (`prisma.config.ts` loads one if present).
2. Put the owner URL in the shell only, from the secret store: `export MIGRATION_DATABASE_URL='<from [IT-05]>'` (never in a file, never in the app environment).
3. Status before: `npx prisma migrate status` — record pending migrations.
4. **Backup now** (`[IT B1]`); record the backup id. No backup → stop.
5. Apply: `npx prisma migrate deploy`. (`npm run db:migrate` refuses non-local targets on purpose; it is for development only.)
6. Status after: `npx prisma migrate status` → "Database schema is up to date". Record the applied names.
7. `unset MIGRATION_DATABASE_URL`; close the shell.

**First migration on a new database only:** the access-administration migration needs the function-owner prerequisites (`access-administration-runbook.md` §2) — IT pre-creates the two NOLOGIN roles or the migration login may create them, and the migration login can `SET ROLE hrms_access_function_owner`; otherwise it stops (fail closed). Then verify the final grant state (`it-pre-production-handoff.md` §4) and record the result.

## 6. Deploy and start the application

1. Deploy the artifact with the environment of §2 (`[IT-01: platform procedure]`).
2. Start: `npm run start` (`next start`, port 3100 behind the proxy `[IT-06]`).
3. If the process exits immediately, read its single `unsafe_runtime_configuration` log line (variable names only), fix the configuration, start again. Never bypass the check.
4. `GET /health` → `{"status":"ok"}` (503 = database unreachable).

## 7. Smoke test (≈ 10 minutes)

| # | Check | Expected | Result |
|---|---|---|---|
| 1 | `GET /api/v1/dev/test-users` | 404 | |
| 2 | Response headers on `/` | HSTS, CSP `frame-ancestors 'self'…`, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy; no `X-Powered-By`; no CORS headers | |
| 3 | Sign in with a real HR account (after A3) | Home loads | |
| 4 | Employee list; open one profile | Loads, no error | |
| 5 | One harmless agreed write on a designated test record — or read-only smoke in production | Saved; history shows it | |
| 6 | `npx prisma migrate status` (migration machine) | Up to date | |

## 8. Release record

| Field | Value |
|---|---|
| Environment | staging / production |
| Tag / commit / artifact id | |
| Migrations applied | |
| Backup id taken before migration | |
| Operator(s) | |
| Start / end time | |
| Health + smoke result | |
| Issues and decisions | |
| Approved by | |

## 9. When something fails

| Situation | Action |
|---|---|
| Migration fails | Stop. Do **not** edit the migration or patch the schema by hand. The previous app version keeps running if the failed migration was additive. Decide with the Technical Owner: **forward-fix** (new migration, next release) or, only if data is at risk, **restore** (Management + System Owner approval; restore into a new instance first, `restore-rehearsal-record.md` procedure) |
| App does not start (configuration) | Fix the configuration (§6.3); nothing else changes |
| App starts but smoke fails | Roll back: redeploy the previous artifact (works because migrations are compatible); record; fix forward |
| Data problem found later | HR corrects through the app's audited correction workflows; never SQL |

## 10. First-time environment setup (once per environment)

1. IT: database, logins (`owner`, `hrms_app`, read-only), network, TLS, secrets (`[IT-01…IT-07, IT-14]`).
2. §5 migrations from an empty database, including the function-owner prerequisites.
3. Access environment record and operators (`access-administration-runbook.md` §3), bootstrap the first two HR admins (§5 of that runbook).
4. §6 start, §7 smoke.
5. HR enters the catalogs through the Organization screens (production: only after A8).
