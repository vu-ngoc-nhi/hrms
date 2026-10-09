# Mini HRS — Decision Register

Last updated: 2026-10-09 (revision 4: PV-01b, PV-02, PV-12 and PV-13 decisions recorded; documentation only). This register is the single place that records the status of each product and engineering decision. Other documents reference these IDs.

| Status | Meaning |
|---|---|
| **Confirmed Decision** | Approved business, product or engineering rule. |
| **MVP Decision** | Accepted for the current version; may change. |
| **Pending Validation** | Needs stakeholder confirmation. The code must not hard-wire it as a permanent rule. |
| **Pending IT Configuration** | Requires IT/identity configuration (e.g. Entra registrations). |
| **Pending Legal Review** | Must be resolved before real employee data or production use. |

> Note: "Confirmed" below means the Product Owner explicitly stated the rule (2026-10-08 / 2026-10-09). Formal sign-off by the other stakeholder groups (HR, IT/Entra, Security/Privacy, Legal, QA/DevOps) has not been recorded yet.

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
| C-09 | **Employee Type model (PV-01, 2026-10-08).** Employee Type = nature of the working relationship (Employee, Service Contractor, Intern…) and belongs to the **employment period**, not the organizational assignment. A department or job-title change never changes it. A genuine relationship change (e.g. Service Contractor → Employee) is a new employment period, preserving history. A **data-entry correction** (wrong type selected) is made on the existing period by an authorized HR user with a reason; no fake period is created (revised 2026-10-09; the baseline DB trigger that blocked in-place changes was removed by migration `20261009000000_allow_employee_type_correction`). The correction API/UI is part of S4; the design leaves room for a later audit trail (changed_by, changed_at, old_value, new_value, reason). Working Arrangement, Employment Status and Probation are separate concepts (see C-16, C-17). | Yes (Working Arrangement and Probation are not modelled in MVP) |
| C-10 | **Email (PV-03, 2026-10-08).** Work Email (company-issued, on the employment period) and Personal/Contact Email (on the person) are separate fields. Neither is an identity key. Operational email rule: before the start date a contact email is enough; from the start date, a person whose Employee Type is expected to receive a company account needs a work email; a Service Contractor without an EmeSoft account may use a contact email. The expectation comes from the HR-managed catalog flag `employee_type.requires_work_email`, which is a **default per Employee Type**, not an absolute rule for every individual (revised 2026-10-09, see C-18). | Yes (catalog-level default only) |
| C-11 | HR_VIEWER is excluded from the MVP; seeds create no HR_VIEWER user and no intentionally role-less user (role-less and disabled accounts exist only in the test database). | Yes |
| C-12 | `person.profile_state` stays deprecated (nullable, unused) and is not dropped in this iteration. | Yes |

### Product-model decisions recorded 2026-10-09 (PV-01b, PV-02) — Confirmed / MVP product model

These are approved for the current product model. Items they explicitly leave open are listed under Pending Validation and Pending Legal Review; nothing below authorizes implementing those open items.

| ID | Decision | Implemented |
|---|---|---|
| C-13 | **MVP Employee Types: Employee, Service Contractor, Intern.** Definitions: **Employee** = a person engaged by EmeSoft under an employment relationship or employment track, *including an approved probation period leading to employment where applicable*; it is not defined by holding a labour-contract document. **Service Contractor** = a person providing services without an employment relationship. **Intern** = a time-limited learning/practical-experience relationship as defined in C-19. **Freelancer** is not a separate type; treat as Service Contractor unless HR later identifies a materially different relationship. **Collaborator** is not a separate type; each case is classified by its actual relationship after HR review. **Outsource / External** workers are excluded from Employee Type and from the Core HR employee model for MVP; if needed later, that is a separate scope (e.g. External Workforce), not a new Employee Type by default. **Probation** and **Full-time/Part-time** are not Employee Types. **Employee Type and Contract Type are separate concepts**: a separate probation agreement versus a labour contract does not by itself change the Employee Type. Legal classification: Pending Legal Review (PL-07). | Catalog values match the demo seed; no new schema |
| C-14 | **Intern → Employee is a genuine relationship change** and starts a new Employment Period. A role merely labelled "Intern" is not assumed to be an internship if it is in practice a junior or probationary employee (classification by actual relationship, PV-12). | No workflow yet (S4) |
| C-15 | **Legacy CLASSIFY is never mapped directly to Employee Type.** `Fulltime` and `Probation` are not migrated automatically, and no historical dates or relationships are inferred from snapshot values. When real legacy files are available: produce a distinct-value/count report without personal data; HR reviews each value and classifies it as **Map / Transform / Discard / Needs Investigation**. No automatic mapping without HR confirmation. | Process only; no importer yet |
| C-16 | **Employment Status is computed**, never an editable stored field. Stable codes `not_started`, `active`, `ended` with display labels **Pre-start**, **Active**, **Ended** (not "Terminated"). Termination, resignation, contract expiry, probation failure, etc. are future **End Reasons**, not lifecycle statuses. Not lifecycle statuses: Probation, Rehire in Progress, On Leave, Maternity Leave, Resigned, Dismissed, Contract Expired. Rehire creates a new Employment Period; before its start date the computed status is Pre-start. (`no_employment` remains a profile condition for a person without any period.) | Computation yes; the UI label for `not_started` still reads "Not Started" — reported as an implementation conflict, not yet changed |
| C-17 | **Probation model B (conceptual approval only).** Probation is a separate effective-dated condition attached to an Employment Period, never a mutually exclusive lifecycle status: a person can be Employment Status = Active and Probation = In Progress at the same time. Future data may include start_date, planned_end_date, actual_end_date, outcome (pending / passed / failed / cancelled) and extension history. Normal pass or early confirmation continues the **same** Employment Period; no new period is created because probation ends successfully. **A Failed outcome does not automatically end the Employment Period**: recording the outcome and an explicit HR "End Employment" action (with End Date and End Reason) are two separate events and must not be coupled. | No (module not approved for implementation) |
| C-18 | **Company account expectation is a default per Employee Type.** Keep the catalog-level `requires_work_email` default for MVP; it is not an absolute rule for every individual (Service Contractors may vary by person/project). A per-Employment-Period override (e.g. `company_account_expected`) is **Deferred / Future Enhancement**; the current design does not prevent adding it as a nullable column on the employment period. | Catalog default yes; override deferred |
| C-19 | **Intern definition (PV-12, confirmed 2026-10-09).** An Intern at EmeSoft is typically a final-year university student, a student preparing for graduation, or a recent graduate with limited professional experience. The primary purpose of the relationship is learning and practical work experience: interns learn while working, gain exposure to a real professional environment, apply academic knowledge in practice, develop technical and professional skills, and perform basic/supporting tasks (possibly small project activities) under the guidance of regular employees. An internship is normally time-limited, commonly about 1–6 months depending on the arrangement. **Product rules:** (1) Intern is a distinct Employee Type. (2) Intern is not an Employee on probation, not an Employment Status and not a Working Arrangement. (3) Internship and probation are conceptually separate. (4) Intern → Employee is a genuine relationship change and creates a new Employment Period (C-14). (5) Completing an internship is not "passing probation". (6) Ending an internship is not "failed probation". (7) Internship duration is represented by the Intern Employment Period dates. (8) No separate top-level "Internship Status". (9) Internship agreements and contracts are documents of the future Contract domain, separate from Employee Type. (10) Vietnam-specific legal classification, agreement requirements, duration limits, allowance/pay and other statutory obligations: Pending Legal Review (PL-07). Company-account eligibility is decided separately (C-20). | Yes for the model (Employee Type catalog + employment period dates); no new schema |
| C-20 | **Intern company account (PV-13, confirmed 2026-10-09).** Interns participate in actual work and need company systems and collaboration tools, so the INTERN Employee Type has the approved **default** `requires_work_email = true`. This is a default policy by Employee Type, not an immutable rule: a future Employment-Period-level override (PV-14, deferred) may cover a legitimate individual exception. Operational completeness: an Intern whose Employment Period has started needs a Work Email; before the start date a Personal/Contact Email is sufficient (C-10). Email remains contact/account data, never the employee identity key. **Terminology note (future, not in this iteration):** the business concept is company-account provisioning, closer to `company_account_expected` than to "work email"; the field `requires_work_email` is not renamed now. | Yes — already matched (catalog value and completeness rule); no code/schema/API change |

## MVP Decisions

| ID | Decision | Notes |
|---|---|---|
| M-01 | Architecture: a single Next.js app (UI + REST in one deployment), PostgreSQL, Prisma. See ADR-0001. | |
| M-02 | Identity keys are separate: `person.id` (UUID), employee code, Entra tenant/object id, and external ids. Employee codes are never reused; auto-issued codes use the format `ES` + at least 4 digits. See ADR-0002. | Code format: PV-08 |
| M-03 | MVP roles are `HR_ADMIN`, `HR_EDITOR` and `API_DOCS_READER` (least privilege). Unknown or retired role codes grant nothing. See ADR-0003. | PV-07, PV-10 |
| M-04 | The operational profile is complete when it has Full Name, the email required by C-10 (`work_email` or `contact_email`), Start Date, Employment Status (an employment period exists), Department, Job Title and Employee Type. It is **computed** at read time from a versioned rule (`operational-mvp-2026-10-08.2`), never stored. DOB, gender, level, legal ID and personal details do not affect it. HR completeness is `not_defined`; legal is `pending_legal_review`. | The item list is an MVP Decision |
| M-05 | Employee Type values are an HR-managed catalog; the MVP set is fixed by C-13. An unknown type after the start date requires a work email (fail-safe). | Intern account default: C-20 |
| M-06 | Employment Status is computed from employment periods: `no_employment`, `not_started`, `active`, `ended` (labels per C-16). | Superseded in detail by C-16 |
| M-07 | Audit events store only the names of changed fields, never values. Idempotency records keep a keyed HMAC for 24 hours; Excel staging is planned to expire after 72 hours. These are product choices, not legal retention periods. See ADR-0004. | PL-01 |
| M-08 | "Position" was renamed "Job Title" in the database, API and UI (no data loss). | |
| M-10 | A profile can be created with only a name; no placeholder employment is created. `require_operational_completeness=true` makes the API reject an incomplete operational profile. | |

## Pending Validation

| ID | Question | Owner | Blocks |
|---|---|---|---|
| PV-01b | *Resolved 2026-10-09* into C-13, C-14, C-15, C-18. Remaining open part: PV-14 (PV-12 confirmed as C-19, PV-13 as C-20). | — | — |
| PV-02 | *Resolved 2026-10-09 at concept level* into C-16, C-17. Remaining open parts: PV-15, PV-16, PV-17. | — | — |
| PV-12 | *Confirmed 2026-10-09* as C-19 (Intern definition and product rules). Classifying individual legacy/real cases labelled "Intern" still follows the actual relationship after HR review (C-13, C-15). | — | — |
| PV-13 | *Confirmed 2026-10-09* as C-20: Interns receive a company account by default (`requires_work_email = true`). | — | — |
| PV-14 | **Per-Employment-Period company-account override** (e.g. `company_account_expected`), for legitimate individual exceptions to the Employee Type default (C-18, C-20). Deferred / Future Enhancement; not built until a real requirement exists. A related future terminology change (`requires_work_email` → `company_account_expected`) is noted in C-20 and is not part of this iteration. | HR/Product | Nothing now |
| PV-15 | **Working Arrangement** (Full-time / Part-time; FTE later) — separate dimension, eventually effective-dated within an Employment Period. Deferred until a real consumer (HR reporting, Leave or Payroll) requires it. Remote, Hybrid, Shift and Flexible are a different dimension and out of scope. | HR/Product | Leave/Payroll integration |
| PV-16 | **Detailed probation workflow and UI** (recording start/planned end, extension, early confirmation, outcome; who may record outcomes; notifications). Model B is approved conceptually (C-17); implementation is not. | HR/Product | Probation module |
| PV-17 | **End Reason catalog** (resignation, dismissal, contract expiry, probation failure, mutual agreement…) and the explicit End Employment action. | HR/Product | S4 end-employment flow |
| PV-18 | Whether EmeSoft needs an **External Workforce** scope for vendor/outsourced workers (separate from Core HR employees). | HR/Product/Legal | Nothing now |
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
| PL-07 | Legal classification rules for **Intern** and **Service Contractor** relationships (and when a contractor or collaborator arrangement is in substance an employment relationship); for interns also agreement requirements, duration limits, allowance/pay and other statutory obligations. | Real catalogs / legacy classification |
| PL-08 | Vietnam-specific **probation** rules: statutory maximum durations, extension rules, probation pay, result notification and other obligations. None of these may be encoded without legal confirmation. | Probation module |
