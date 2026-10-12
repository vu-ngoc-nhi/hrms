# Mini HRS — Core HR (phase 1, S0–S3)

Core HR covers:
- catalogs (departments, job titles, levels, employee types);
- the employee list;
- creating profiles (name only, or with an operational profile);
- the employee detail view.

The UI and REST API run in one Next.js app on PostgreSQL. English is the default product language (decision C-01).

> **Local development with synthetic data only.**
> - Sign-in uses a *development test identity*, **not Microsoft Entra ID**.
> - No Excel import/export, contracts, payroll or leave tool integration yet.
> - Not production-ready.
> - Decision statuses: `docs/decision-register.md`.

## Requirements
- Node.js 24 (`.nvmrc`), npm 11.
- Docker: PostgreSQL 18.6 runs in container `hrms-core-hr-db` on `127.0.0.1:55432`.

## Run locally
```bash
npm ci
cp .env.example .env      # fill AUTH_TEST_ISSUER_SECRET and IDEMPOTENCY_HMAC_KEY (openssl rand -base64 48 / 32)
npm run db:up             # PostgreSQL + role hrms_app + databases hrms_dev, hrms_test
npm run db:migrate        # guarded: local targets only
npm run db:generate       # Prisma Client
npm run access:provision-local  # local only: development access operator + environment (C-89)
npm run db:seed           # insert-only: test accounts, demo catalogs, demo profiles (only if none exist)
npm run access -- env --env local   # guarded access administration (docs/production/access-administration-runbook.md)
npm run dev               # http://localhost:3100 -> /login, pick a test account
```

| Test account | Role |
|---|---|
| Test HR Admin | HR_ADMIN |
| Test HR Editor | HR_EDITOR |
| Test Developer (API Docs) | API_DOCS_READER: `/internal/docs` |

Demo profiles use realistic Vietnamese names; departments, job titles, employee types and statuses are English demo values. Role-less and disabled accounts exist only in the test database.

## Checks
```bash
npm run typecheck && npm run lint
npm test                  # sets APP_ENV=test; recreates ONLY local hrms_test (guarded, fails closed), then runs all tests
npm run build
```

## Database safety
- `npm test` / `npm run db:reset-test` reset the schema only when all of these hold: `APP_ENV=test`, the database is exactly `hrms_test`, the host is loopback, and no production-like variables are present (`src/lib/db-safety.ts`).
- `npm run db:migrate` refuses non-local or production targets. Staging and production migrations are manual and need explicit approval.
- `hrms_dev` is never reset by scripts.

## Production startup check
- `next start` (`npm run start`) runs as `NODE_ENV=production` and refuses to start unless `APP_ENV=production` with a complete, non-development configuration (`unsafeRuntimeConfig` in `src/lib/config.ts`, run by `src/instrumentation.ts`). Local development uses `npm run dev`. Details: `docs/production/security-headers.md`.

## Layout
- `src/app/**/route.ts`: HTTP protocol only.
- `src/app/**/page.tsx`: UI calling REST.
- `src/i18n/`: UI message catalog (English).
- `src/modules/`: business rules and authorization.
- `src/contracts/core-hr/`: schema registry, operations, OpenAPI builder. `contracts/core-hr/openapi.json` is generated.
- `prisma/migrations/`: SQL source of truth.
- `tests/`: unit, integration (real DB) and contract.
- `docs/`: spec, decision register, ADRs, legal notes, API conventions. `docs/archive/` holds superseded Vietnamese versions.

## Known technical risks
- The `search` query string shows up in `next dev` request logs (no tokens or bodies). Proxy and access logs must not record query strings before any pilot.
- No application-level encryption yet. No sensitive fields are stored; the API rejects them.
- No automated E2E UI tests. The UI is checked manually in a browser.
