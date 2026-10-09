# ADR-0001 — Separate Core HR app with UI and REST API in one deployment

- Status: **MVP Decision** (decision register M-01). Accepted 2026-10-07. Revisit if the leave tool's code or infrastructure becomes available.

## Context
The HRMS repository started empty. The leave tool is a separate internal system; only its OpenAPI document (`api-1.json`) is available, with no code, manifests or infrastructure details. The goal is runnable S0–S3 functionality that does not depend on the leave tool.

## Options
| Option | Pros | Cons | When it fits |
|---|---|---|---|
| A. Extend the leave tool backend | Reuses auth, users and operations | No code to assess; risk to leave workflows; blurs data boundaries | When the repo is available and its owners agree module boundaries |
| **B. Separate Core HR app; same REST, Entra and OpenAPI conventions; UI + API in one deployment** | Can start now; one language; leave tool integrated later via an adapter | Identity links across two systems; two deployments to run | **Current choice** |
| C. Separately deployed frontend and backend | Independent life cycles | More runtimes, CORS/configuration and operations | When operations has a concrete need |

## Decision
Option B. Versions are pinned exactly (`package-lock.json`, `--save-exact`):

| Component | Version | Note |
|---|---|---|
| Node.js | 24.x LTS (`.nvmrc`, `engines`) | |
| Next.js (App Router) | 16.4.0 | React 19.3.0 |
| TypeScript | 5.9.3 | 7.x (native port) not adopted until tooling compatibility is verified |
| PostgreSQL | 18.6 (`postgres:18-alpine`, digest-pinned) | Docker Compose, 127.0.0.1:55432 |
| Prisma ORM | 7.10.0 + `@prisma/adapter-pg` 7.10.0 | 8.0.0-rc not adopted (the npm `latest` tag is an RC) |
| Zod | 4.6.5 | Schema registry → OpenAPI 3.1 via `z.toJSONSchema` |
| jose | 6.2.12 | JWT verification |
| Scalar | `@scalar/api-reference-react` 0.9.78 | Bundled locally, no CDN |
| Vitest / ESLint | 4.1.11 / 9.39.5 + `eslint-config-next` 16.4.0 | |

Code boundaries:
- `src/app/**/route.ts` handles protocol only: auth → permission → parse → service call → JSON.
- `src/modules/*` holds business rules and authorization.
- `src/contracts/core-hr` is the single source for validation schemas and OpenAPI.
- `src/i18n` holds UI messages (C-01).
- `prisma/migrations` (hand-written SQL) is the source of truth for the database; `schema.prisma` only describes it for Prisma Client.
- No microservices, queues or Redis. No empty placeholder modules.

## Consequences
- The app connects as `hrms_app`, which has no DDL and no UPDATE/DELETE on audit. Migrations run as `hrms_owner` through a guarded script (C-07).
- Every screen uses the REST API with a bearer token; there are no business Server Actions.
