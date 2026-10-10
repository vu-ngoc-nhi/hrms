# Mini HRS — Access Control Direction (architecture review and target model)

- Status: **Confirmed governance direction C-85** (2026-10-10). Architecture review and target model only — **no authorization change is implemented**; Phase 1 roles and permissions are unchanged.
- Applies C-84 (*Strict on history and integrity, flexible on operations*; scale down process complexity, not engineering quality). Principles summary: `CLAUDE.md` § *Access control principle* and `docs/design/emesoft-design-philosophy.md` § 15.

## 1. Principles

- **Flexible role configuration, strict authorization enforcement.**
- Access control is configured through **roles and permissions**, never hard-coded to individual users or organisational job titles.
- **Organisational position may suggest access, but must not silently determine security privileges.**
- Adding or replacing HR staff normally requires **role assignment**, not a code change, migration or deployment.

## 2. Current Phase 1 authorization (review, 2026-10-10)

| Question | Finding |
|---|---|
| Are endpoint checks capability-based? | **Yes.** Every route declares one permission in the contract registry (`src/contracts/core-hr/operations.ts`); the shared handler (`src/lib/http/handler.ts`) authenticates and checks `principal.permissions.has(op.permission)` before parsing the body. Field- and date-level rules in services also check permissions (`effective-date-policy.ts`, `work-email.ts`, `profile-edit.ts`, `people/service.ts`). The UI uses `session.can(<permission>)` from `GET /api/v1/core-hr/me/permissions`. The permission matrix test verifies every operation server-side. |
| Where are role names checked directly? | **Nowhere in decision logic.** Role codes appear only in (a) the role → permission map `ROLE_PERMISSIONS` and `ROLE_CODES` in `src/modules/identity/permissions.ts`; (b) `authenticate.ts`, which loads the user's role codes from `app_user_role` and expands them with `permissionsForRoles` (unknown codes ignored — fail closed); (c) `GET /api/v1/me`, which returns role codes for display; (d) seeds and tests; (e) comments, UI prop comments and OpenAPI descriptions such as "employment.correct (HR_ADMIN)". |
| Are HR_ADMIN / HR_EDITOR bundles or embedded logic? | **Bundles of permissions.** Business rules are expressed with capabilities (e.g. backdated business events require `employment.correct`, C-25), not with role names. |
| Can it migrate to configurable Access Roles without rewriting endpoints? | **Yes.** Only the role → permission expansion changes (from a code map to stored role definitions); routes, services, UI checks and the contract registry keep using permissions. |
| Patterns that make migration harder | (1) Role definitions are a **static code map** (`ROLE_PERMISSIONS`) — must move to stored data. (2) The DB constraint on `app_user_role.role_code` is a **format** CHECK (`^[A-Z][A-Z0-9_]{1,49}$`, migration `20261008000000_mvp_decisions`, which replaced the original `IN (...)` list that included HR_VIEWER); it accepts any well-formed code, and unknown codes such as HR_VIEWER grant nothing in code (fail closed). *Corrected 2026-10-10 — the earlier text described the original list.* (3) `RoleCode` is a TypeScript union used in `Principal.roles`. (4) OpenAPI descriptions and code comments name roles ("HR_ADMIN") — documentation coupling only. (5) No access-management API or security audit trail exists yet; role grants are written only by seed scripts (`app_user_role.granted_by/granted_at` exist). None is a material conflict; all are mechanical. |

Note: current permission identifiers use the established convention `employees.read`, `employees.update`, `employment.manage`, `employment.correct`, `catalogs.read`, `catalogs.manage`, `docs.read` … Examples elsewhere such as `employee.view` or `catalog.manage` are illustrative; existing identifiers are **not** renamed (stable product capabilities). New ones (e.g. `access.manage`, `audit.read`) follow the existing convention when they are introduced.

## 3. Target model — three layers

| Layer | What it is | Who controls it |
|---|---|---|
| **Permission** | A stable product capability with code-defined semantics (`employment.correct`, …) | **Code** — identifiers, meaning and server-side enforcement; administrators cannot invent permission identifiers |
| **Access Role** | A configurable, named bundle of existing permissions (e.g. "HR Operator", "C&B Senior", "HR Lead" — examples only) | **Configuration** by authorized administrators: create, clone, rename, enable/disable, add/remove allowed permissions |
| **User Role Assignment** | One account ↔ one or more Access Roles | **Configuration**: account available → assign role(s); no code change or deployment |

Composition rule: **effective permissions = union of the permissions of the user's enabled roles**. A disabled account or a disabled role grants nothing. No deny / precedence rules unless a demonstrated EmeSoft use case requires them.

## 4. Organisation vs security

Department, Job Title, position, Level and Employee Type are **organisational** facts and are **never** an authorization source. A future, optional **Position / Job Title → Suggested Access Role** mapping may assist onboarding (e.g. Job Title *Senior C&B* → suggested role *C&B Senior*), but only as a suggestion that an authorized administrator confirms; changing a Job Title never grants or revokes privileges automatically.

## 5. Configurable vs code-controlled

| Configurable (future) | Code-controlled |
|---|---|
| Access Role definitions (name, enabled) | Permission identifiers and their semantics |
| Permission membership of each role (from the code catalog only) | Server-side enforcement (handler, services) |
| User ↔ role assignments | Security invariants (fail closed, disabled accounts, anti-escalation) |
| Enable / disable a role | Protected system roles / guardrails where necessary (e.g. never leave zero administrators) |
| Optional suggested Position → Role mappings | The permission catalog shown to administrators |

## 6. Migration direction from HR_EDITOR / HR_ADMIN (future, when approved)

1. Forward migration adds stored role definitions (e.g. `access_role` with code, name, enabled, protected flag; `access_role_permission`), seeded with **exactly** today's bundles: HR_ADMIN, HR_EDITOR, API_DOCS_READER → no behaviour change.
2. Replace the `app_user_role.role_code` CHECK with a reference to the stored roles (existing assignments keep their codes).
3. `permissionsForRoles` reads enabled roles from the database instead of `ROLE_PERMISSIONS`; permission identifiers are still validated against the code catalog (unknown permissions in stored data are ignored — fail closed).
4. Add `access.manage` and a minimal access-management API/UI (role CRUD, assignment), with a **separate security audit trail** (§8).
5. Routes, services, UI checks and the contract registry do not change. The permission matrix test switches from fixed role bundles to configured roles.

## 7. Guardrails against privilege escalation

- Only holders of `access.manage` manage roles and assignments.
- A user cannot grant a permission they are not authorized to administer (exact rule to confirm — §11 Q2).
- Disabled accounts and disabled roles grant nothing; server-side authorization stays authoritative; UI visibility is never a security boundary.
- Sensitive permissions (`access.manage`, `employment.correct`, a future `employment.void` if ever split, audit/security administration) show a clear warning when granted; no approval chain unless a demonstrated risk appears.
- Guardrail: the system must not end with zero active administrators able to manage access.

## 8. Access audit (separate trail)

Access-management actions get their own **security audit** — never mixed with Employee lifecycle history: actor, affected user or Access Role, action (create/rename/enable/disable role, add/remove permission, assign/unassign), previous state where appropriate, new state, recorded timestamp, request/correlation ID. Audit is evidence, not rollback state.

## 9. Scope — extension point only

Future authorization may need scope (self / team / department / all), e.g. `employees.read` limited to a team. **Not designed now.** The extension point is the existing single authorization path (handler + `principal.permissions`): a later scope can be attached to a permission grant and evaluated there without touching every endpoint. Avoid Department × Position × Level × Role × Scope matrices unless a demonstrated requirement appears.

## 10. Not built at EmeSoft scale

Generic policy engines; ABAC rule builders; allow/deny precedence; complex scope matrices; approval workflows for every role change; automatic Job Title → access provisioning; user-created permission identifiers; external IAM provisioning workflows.

**C-84 check:** the target is *simple role administration + strict permission enforcement + no code change when HR staffing changes*. Each excluded item adds significant complexity without a demonstrated EmeSoft risk, so the simpler model is preferred.

## 11. PV-25 authorization recommendation

**Reuse `employment.correct` for Void Employment Period (and its eligibility preview). Do not introduce `employment.void` now.**

Decision test — *is Void a materially more sensitive boundary that EmeSoft is likely to assign differently from ordinary historical correction?*

- Void is a **controlled correction** (C-84 level 2) of the same nature as Historical Correction and Reverse End Employment: explicit HR_ADMIN action, mandatory reason, audit, no deletion; the approved PV-25 design already uses `employment.correct`.
- At EmeSoft scale the same few HR administrators handle all corrections; no requirement or scenario shows someone allowed to correct history but not to void (or the reverse).
- Correction actions are already comparably impactful (period date corrections, Reverse End), so Void does not create a materially higher boundary than the existing `employment.correct` holders already have.
- Splitting later is **non-breaking**: add `employment.void`, grant it to every role holding `employment.correct`, and change the single permission declared for the Void operation in the contract registry.

**Implementation note for PV-25:** declare the permission only in the contract registry entries for the Void and preview operations (no role-name checks, no ad-hoc checks), so a future split touches one place. *Implemented 2026-10-10 (C-86): `getVoidEligibility` and `createVoidEmployment` declare `employment.correct` in `src/contracts/core-hr/operations.ts` only; the permission matrix test covers both.*

## 12. Open business questions (not blocking PV-25)

| # | Question | Recommendation |
|---|---|---|
| Q1 | Who administers access (`access.manage`): HR lead, IT, or both? | Decide when access management is built |
| Q2 | Anti-escalation rule: may an `access.manage` holder grant any permission, or only permissions they hold? | Only permissions they hold, except protected guardrails |
| Q3 | Protected roles / break-glass: which roles cannot be disabled, and is "at least one active administrator" enough? | "At least one active administrator" guardrail |
| Q4 | Is a Position → Suggested Role mapping wanted at all? | Optional, later |
| Q5 | Will Entra groups ever feed role assignment? (today roles come only from HRMS data, C-04/ADR-0003; PV-11) | Keep HRMS-owned assignments; revisit with IT |
