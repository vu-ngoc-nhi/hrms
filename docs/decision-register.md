# Mini HRS — Decision Register

Last updated: 2026-10-08 (revision 2: PV-01, PV-03, PV-11 decisions; hrms_dev reset). This register is the single place that records the status of each product and engineering decision. Other documents reference these IDs.

| Status | Meaning |
|---|---|
| **Confirmed Decision** | Approved business, product or engineering rule. |
| **MVP Decision** | Accepted for the current version; may change. |
| **Pending Validation** | Needs stakeholder confirmation. The code must not hard-wire it as a permanent rule. |
| **Pending Legal Review** | Must be resolved before real employee data or production use. |

> Note: "Confirmed" below means the Product Owner explicitly stated the rule on 2026-10-08. Formal sign-off by the other stakeholder groups (HR, IT/Entra, Security/Privacy, Legal, QA/DevOps) has not been recorded yet.

## Confirmed Decisions

| ID | Decision | Implemented |
|---|---|---|
| C-01 | English is the default product language for UI, system terminology, validation, documentation, tests and controlled business labels (departments, job titles, statuses…). Localization-ready: UI strings live in `src/i18n/messages/en.ts`. Vietnamese is used for Vietnam-specific legal or official business data (e.g. `job_title.name_vi`). Personal names are never translated: demo employees use realistic Vietnamese names. | Yes |
| C-02 | Business terminology is English in both UI and code (e.g. Job Title, Employee Type). The database never depends on display text: logic uses ids, codes and stable English enum values. | Yes |
| C-03 | Development uses synthetic data only. Using real employee data is a hard pre-production gate (see PL-*). | Yes |
| C-04 | EmeSoft IT / Entra Administrator owns the production App Registrations. The Web/SPA and API registrations are configured separately. Tenant, client IDs, audience and scope come only from environment or configuration. Expected: App ID URI `api://<HRMS_API_CLIENT_ID>`, delegated scope `access_as_user`. | Config and verifier yes; MSAL sign-in not yet |
| C-05 | `npm test` may drop and recreate the schema of local `hrms_test`, but only when all of these hold: `APP_ENV=test`, the database name is exactly `hrms_test`, the host is loopback, and no production-like variables are present. The rule is enforced in code (`src/lib/db-safety.ts`), checked again against the server's `current_database()`, and fails closed. | Yes |
| C-06 | `hrms_dev` is never reset destructively without explicit approval. The seed only inserts missing rows. | Yes |
| C-07 | Destructive DB operations, staging or production migrations, production data changes, deployments and irreversible Git operations require an explicit stop, explanation and approval. `npm run db:migrate` refuses non-local or production targets. | Yes (code guard + CLAUDE.md) |
| C-08 | Decisions are tracked with the four statuses above. Pending items are never silently turned into permanent rules. | This register |
| C-09 | **Employee Type model (PV-01, 2026-10-08).** Employee Type = nature of the working relationship (Employee, Service Contractor, Intern…) and belongs to the **employment period**, not the organizational assignment. A department or job-title change never changes it. A relationship change (e.g. Service Contractor → Employee) is a new employment period; the database blocks changing a period's type in place. Working Arrangement (Full-time, Part-time…) and Employment Stage/Status (Probation, Active, Rehire in Progress, Terminated…) are separate concepts. | Yes (Working Arrangement and Employment Stage are not modelled in MVP) |
| C-10 | **Email (PV-03, 2026-10-08).** Work Email (company-issued, on the employment period) and Personal/Contact Email (on the person) are separate fields. Neither is an identity key. Operational email rule: before the start date a contact email is enough; from the start date, types that receive a company account need a work email; a Service Contractor without an EmeSoft account may use a contact email. "Receives a company account" is the HR-managed flag `employee_type.requires_work_email`. | Yes |
| C-11 | HR_VIEWER is excluded from the MVP; seeds create no HR_VIEWER user and no intentionally role-less user (role-less and disabled accounts exist only in the test database). | Yes |
| C-12 | `person.profile_state` stays deprecated (nullable, unused) and is not dropped in this iteration. | Yes |

## MVP Decisions

| ID | Decision | Notes |
|---|---|---|
| M-01 | Architecture: a single Next.js app (UI + REST in one deployment), PostgreSQL, Prisma. See ADR-0001. | |
| M-02 | Identity keys are separate: `person.id` (UUID), employee code, Entra tenant/object id, and external ids. Employee codes are never reused; auto-issued codes use the format `ES` + at least 4 digits. See ADR-0002. | Code format: PV-08 |
| M-03 | MVP roles are `HR_ADMIN`, `HR_EDITOR` and `API_DOCS_READER` (least privilege). Unknown or retired role codes grant nothing. See ADR-0003. | PV-07, PV-10 |
| M-04 | The operational profile is complete when it has Full Name, the email required by C-10 (`work_email` or `contact_email`), Start Date, Employment Status (an employment period exists), Department, Job Title and Employee Type. It is **computed** at read time from a versioned rule (`operational-mvp-2026-10-08.2`), never stored. DOB, gender, level, legal ID and personal details do not affect it. HR completeness is `not_defined`; legal is `pending_legal_review`. | The item list is an MVP Decision |
| M-05 | Employee Type values are an HR-managed catalog. Demo values: Employee, Service Contractor, Intern. An unknown type after the start date requires a work email (fail-safe). | Real values and flags: PV-01b |
| M-06 | Employment Status is computed from employment periods: `no_employment`, `not_started`, `active`, `ended`. | Extra states: PV-02 |
| M-07 | Audit events store only the names of changed fields, never values. Idempotency records keep a keyed HMAC for 24 hours; Excel staging is planned to expire after 72 hours. These are product choices, not legal retention periods. See ADR-0004. | PL-01 |
| M-08 | "Position" was renamed "Job Title" in the database, API and UI (no data loss). | |
| M-10 | A profile can be created with only a name; no placeholder employment is created. `require_operational_completeness=true` makes the API reject an incomplete operational profile. | |

## Pending Validation

| ID | Question | Owner | Blocks |
|---|---|---|---|
| PV-01b | Real Employee Type values and their `requires_work_email` flag (e.g. do Interns receive an EmeSoft account?). How the legacy CLASSIFY column ("Fulltime", "Probation") maps: it mixes Working Arrangement and Employment Stage, so it is not imported as Employee Type. | HR/Product | Real catalogs; legacy import |
| PV-02 | Employment Stage/Status values beyond the computed MVP set (probation, on leave, suspended, rehire in progress, terminated) and Working Arrangement values and placement. | HR/Product | S4 status events |
| PV-04 | Is an HR Profile Completeness rule needed, and with which fields? | HR/Product | Nothing yet |
| PV-05 | Meaning of the legacy Excel columns L/S/T, G–I, AA–AC, AS–AV, M, BC and R (spec §1, D-04 to D-07, D-13, D-14). | HR | Legacy import mapping |
| PV-06 | Real catalogs: departments, job titles (EN/VI), levels, employee types, company email domains. | HR | Pilot |
| PV-07 | Is there a business case for a read-only HR role? If yes, re-add it as a new role (the architecture supports this). | HR/Product | Nothing |
| PV-08 | Legacy employee code format; codes that differ only by case; the prefix for new codes. | HR | Legacy import |
| PV-09 | Rehire rules (the current default keeps the same employee code). | HR/Product | S4 rehire flow |
| PV-10 | Who needs `API_DOCS_READER`, and does it stay a separate technical role? | Engineering/Security | Nothing |
| PV-11 | **Pending IT configuration.** IT provides the Tenant ID, API Client ID, SPA Client ID and the confirmed delegated scope, and confirms that the API registration issues **v2** access tokens: Microsoft Graph manifest property `api.requestedAccessTokenVersion = 2` (null defaults to v1; the older Azure AD Graph manifest name was `accessTokenAcceptedVersion`). The API accepts only `ver = 2.0` tokens with `aud = <API Client ID>`; the App ID URI is not accepted as an audience. Source: Microsoft Learn, "Understand the app manifest (Microsoft Graph format)" and "Access token claims reference" (checked 2026-10-08). | IT/Entra Admin | Real sign-in |

## Pending Legal Review

Details: `docs/legal/legal-review-s0-s3.md`. No legal conclusion or retention period is assumed anywhere in the code.

| ID | Item | Needed before |
|---|---|---|
| PL-01 | Retention schedule per data group, with a basis; handling at termination; backups. | Real data |
| PL-02 | Hosting, vendors, cloud and AI processing; encryption at rest and in transit; processor contracts. | Real data |
| PL-03 | Enabling sensitive or third-party data groups (health, ID images, bank/card data, children and dependants). | Enabling those groups |
| PL-04 | Whether a personal-data impact assessment is required, and who owns it (applicability of small-enterprise exemptions). | Real data |
| PL-05 | Processing basis per field, employee notices or consent, and the data-subject request process. | Real data |
| PL-06 | Whether HRMS is meant to serve as the statutory labour management book. | That scope decision |
