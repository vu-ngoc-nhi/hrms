# Mini HRS — Dependency Advisory Triage (Gate A2, L3)

- Date: 2026-10-12. Source: `npm audit --omit=dev` and `npm audit` on `main` (lockfile unchanged). Documentation only: **no dependency was upgraded or downgraded.**
- Revision 2 (2026-10-12): counts normalized (§0). Revision 1 said "3 distinct advisories" for the `--omit=dev` output; the correct figure is **4** (the two `mysql2` advisories were counted once), and one of them is **moderate**, not high. Risk classification unchanged.
- Result: **no advisory is exploitable through the Mini HRS production request path. Nothing is escalated.** None blocks Gate A; all are tracked for the normal upgrade cadence (Gate C).

## 0. Normalized counts

npm counts one *finding* per package on a vulnerable dependency path; a package's severity is the highest of anything below it. The numbers that matter are the **unique advisories** and **where the code runs**.

| Where the code runs | npm findings (packages) | Unique advisories | Advisory severity | Reachable in Mini HRS? |
|---|---|---|---|---|
| **Runtime — server** (request path: `next`, `react`, `pg`, `@prisma/adapter-pg`, `@prisma/client` runtime, `jose`, `zod`) | **0** | **0** | — | — |
| **Runtime — browser, `/internal/docs` only** (Scalar API reference → disabled AI agent) | 7 (all low) | **1** — GHSA-866g-f22w-33x8 | low | No (agent and MCP disabled, no AI provider) |
| **Build / migration only** (Prisma CLI: `prisma generate`, attended `prisma migrate deploy`) | 4 (all reported high) | **3** — GHSA-ggr8-5vv4-36mx (`deepmerge-ts`), GHSA-3f6p-5ww8-9rcr (`mysql2`), GHSA-rgwj-5xj2-c3m3 (`mysql2`) | high, high, **moderate** | No (trusted config file; MySQL never used) |
| **Dev / lint only** (`eslint-config-next`, never shipped) | 5 (all reported high) | **1** — GHSA-vfj7-8cjw-p6xm (`braces`) | high | No (repository's own glob patterns) |
| **Total** | **16** (9 high, 7 low) | **5** (3 high, 1 moderate, 1 low) | | **0 reachable** |

How this maps to the two npm commands:

| Command | Findings reported | = categories above | Unique advisories |
|---|---|---|---|
| `npm audit --omit=dev` | 11 (4 high, 7 low) | browser runtime 7 + build/migration 4 — the Prisma CLI appears because `@prisma/client` depends on `prisma` | 4 |
| `npm audit` | 16 (9 high, 7 low) | the above + dev/lint 5 | 5 |

Duplicated findings caused by chains: of the 16 findings, only 4 packages carry an advisory themselves (`@ai-sdk/provider-utils`, `deepmerge-ts`, `mysql2`, `braces`); the other **12** are reported only because they depend on one of those (`ai`, `@ai-sdk/gateway`, `@ai-sdk/vue`, `@scalar/agent-chat`, `@scalar/api-reference`, `@scalar/api-reference-react`, `@prisma/config`, `prisma`, `micromatch`, `fast-glob`, `@next/eslint-plugin-next`, `eslint-config-next`).

## 1. Why these appear in the "production" tree

| Chain | Path | Used at runtime? |
|---|---|---|
| Prisma CLI | `@prisma/client@7.10.0` → `prisma@7.10.0` → `@prisma/config@7.10.0` → `deepmerge-ts@7.1.5`; `prisma` → `mysql2@3.15.3` | **No.** The running app uses the generated client and `@prisma/adapter-pg`. The `prisma` CLI runs at build time (`prisma generate`) and in the attended migration step (`prisma migrate deploy`); `@prisma/client` declares it as a dependency, so `--omit=dev` keeps it |
| Scalar API reference | `@scalar/api-reference-react@0.9.78` → `@scalar/api-reference@1.73.0` → `@scalar/agent-chat@0.12.41` → `ai@6.0.33` / `@ai-sdk/vue@3.0.33` → `@ai-sdk/gateway`, `@ai-sdk/provider-utils` | Browser code on `/internal/docs` only, shown to `API_DOCS_READER`. The AI agent and MCP are **disabled** in `src/app/internal/docs/ApiReference.tsx` (`agent: { disabled: true }`, `mcp: { disabled: true }`, `telemetry: false`) and no AI provider is configured |

## 2. Triage (findings reported by `npm audit --omit=dev`)

| Package (severity) | Advisory | Runtime / dev | Reachable relevance to Mini HRS | Affected production surface | Available fix | Breaking-change risk | Recommendation | Gate A disposition |
|---|---|---|---|---|---|---|---|---|
| `deepmerge-ts` 7.1.5 (high) | GHSA-ggr8-5vv4-36mx — stack exhaustion when merging recursive object graphs | Tooling (Prisma CLI config loading) | Merges `prisma.config.ts`, which is our own trusted, non-recursive file. No user input reaches it | None (attended migration / build step only) | `deepmerge-ts` ≥ 8 — npm proposes `prisma@6.19.3` (a **downgrade** across a major) | High: Prisma 6 lacks the v7 config + driver-adapter model this project uses | Do not downgrade. Take the Prisma 7.x release that moves to `deepmerge-ts` ≥ 8 | Accepted — not blocking; Gate C upgrade |
| `@prisma/config` 7.10.0 (high) | via `deepmerge-ts` | Tooling | Same as above | None | Same | Same | Same | Same |
| `mysql2` 3.15.3 (package rated high) | GHSA-3f6p-5ww8-9rcr (high) — auth-plugin downgrade leaks a plaintext password to a malicious MySQL server; GHSA-rgwj-5xj2-c3m3 (moderate) — unbounded zlib inflate (DoS) in the compressed MySQL protocol | Tooling (Prisma CLI) | Only reachable when connecting to a **MySQL** server. Mini HRS uses PostgreSQL exclusively; `mysql2` is never loaded | None | `mysql2` ≥ 3.23.1 via a future Prisma release; npm proposes the same `prisma@6.19.3` downgrade | High (as above) | Do not downgrade; no override needed | Accepted — not blocking; Gate C upgrade |
| `prisma` 7.10.0 (high) | via `@prisma/config`, `mysql2` | Tooling | Same as above | None — the attended migration machine runs it against our own PostgreSQL | Same | Same | Same; the migration runbook (A6) pins the Prisma version from the lockfile | Accepted — not blocking |
| `@ai-sdk/provider-utils` (low) | GHSA-866g-f22w-33x8 — uncontrolled resource consumption (CVSS 4.3) | Runtime (browser bundle of the docs page) | Affects processing of AI-provider responses. The agent is disabled and no provider exists, so the code path is not executed | `/internal/docs` in the browser of an `API_DOCS_READER`; worst case would be a slow tab, not server or data impact | npm proposes `@scalar/api-reference-react@0.8.36` (a **downgrade** across a minor-major line) | Medium: older docs renderer, possible regressions in the OpenAPI 3.1 view | Do not downgrade. Take the next Scalar release that updates `ai` / `@ai-sdk/*` | Accepted — not blocking; Gate C upgrade |
| `@ai-sdk/gateway` (low) | via `@ai-sdk/provider-utils` | Runtime (docs page) | Same | Same | Same | Same | Same | Same |
| `ai` (low) | via `@ai-sdk/*` | Runtime (docs page) | Same | Same | Same | Same | Same | Same |
| `@ai-sdk/vue` (low) | via `ai`, `@ai-sdk/provider-utils` | Runtime (docs page) | Same | Same | Same | Same | Same | Same |
| `@scalar/agent-chat` (low) | via `ai` | Runtime (docs page) | Agent UI, disabled by configuration | Same | Same | Same | Same | Same |
| `@scalar/api-reference` (low) | via `@scalar/agent-chat` | Runtime (docs page) | Same | Same | Same | Same | Same | Same |
| `@scalar/api-reference-react` (low, direct) | via `@scalar/api-reference` | Runtime (docs page) | Same | Same | Same | Same | Same | Same |

## 3. Escalation check

An advisory would be escalated (and could block Gate A) if it were reachable from an HTTP request, from authentication, from the database driver in use (`pg`, `@prisma/adapter-pg`, `@prisma/client` runtime) or from data handling. None is: `next`, `react`, `pg`, `@prisma/adapter-pg`, `@prisma/client` runtime, `jose` and `zod` have no reported advisory on this date.

## 4. Re-check rule

Run `npm audit --omit=dev` before each staging rehearsal and before the A8 decision; any **new** advisory on the runtime path above is triaged with this table. Upgrades follow the normal release procedure (full quality gate, staging first); counts are never forced to zero by downgrades or blanket `npm audit fix --force`.

## Appendix — development-only advisories (`npm audit` without `--omit=dev`)

| Package (severity) | Advisory | Use | Fix offered | Disposition |
|---|---|---|---|---|
| `braces`, `micromatch`, `fast-glob`, `@next/eslint-plugin-next`, `eslint-config-next` (high ×5) | GHSA-vfj7-8cjw-p6xm — stack exhaustion through deeply nested brace patterns | ESLint only, with the repository's own glob patterns | `eslint-config-next@14.2.35` (a downgrade across majors from 16.4.0) | Not shipped to production; not exploitable with trusted patterns. Upgrade with the next `eslint-config-next` release. Not Gate A |
