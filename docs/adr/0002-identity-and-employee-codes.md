# ADR-0002 — Person, account, external identity and employee code

- Status: **MVP Decision** (M-02). Code format and rehire rules: **Pending Validation** (PV-08, PV-09).

## Decision
These keys are distinct and never substitute for one another:

| Key | Table | Meaning |
|---|---|---|
| `person.id` (UUID) | `person` | Stable internal id of a human record; exists even without an email or account |
| `employee_code` | `person.employee_code` + `employee_code_registry` | HR-facing code; legacy codes kept as-is; never reused |
| (`entra_tenant_id`, `entra_object_id`) | `app_user` | Login account; never creates or merges profiles |
| (`system`, `external_id`) | `external_identity` | e.g. `leave_tool` + leave tool `User.id`; unique per system |

- People are never matched or merged by name or email. Work email belongs to an employment period.
- Auto-issued codes are `ES` + at least 4 digits, taken from a PostgreSQL sequence (safe under concurrency). Numbers that collide with a registered legacy code are skipped.
- `employee_code_registry` is insert-only for the app role, and `lower(code)` is unique. A code string is therefore bound to at most one person, ever.
- A deferred FK ensures `person (employee_code, id)` is always registered.
- Setting a legacy code requires `employees.set_code` (HR_ADMIN).
