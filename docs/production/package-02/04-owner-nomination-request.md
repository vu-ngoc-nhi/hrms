# Package 02 — Owner nomination request (DRAFT — NOT SENT)

- Sender: HR Lead. Recipient: Management.
- Rules applied: C-90 (named owners; at least two operational HR administrators), C-85 (ownership grants no data access by itself), PV-28 F (at most two access operators), C-93 C (an operator cannot grant access to their own identity).
- When answered: record the names in `docs/decision-register.md` (PV-26, PV-28 F). Gate A4 still needs operator provisioning and a supervised staging rehearsal.

---

**Subject:** Mini HRS — please nominate the system owners and administrators

Dear [Management],

Before Mini HRS can hold real employee data, five roles must be held by named people, so that production never depends on one person and every access change has an accountable owner.

| Role | Responsibility | Suggested profile | Nominee | Backup / deputy |
|---|---|---|---|---|
| **System Owner** | Owns how HR uses Mini HRS and its business rules; requests access changes; reviews access quarterly; co-signs the Real Data Go/No-Go | HR Lead | | — |
| **Technical Owner** | Deployments, migrations, backups and restores, incidents; co-signs the Go/No-Go | Development lead or IT | | |
| **Primary HR Admin** | Day-to-day HR administration including corrections in the app (HR_ADMIN role) | Senior HR staff | | — |
| **Backup HR Admin** | Same rights, so HR administration never depends on one person | Another HR staff member | | — |
| **Access operators** (max. two) | Run the guarded access command on the System Owner's written request (create/disable HR users, assign roles); cannot read HR data and cannot grant access to themselves | Technical Owner + one deputy (IT or Development) | 1. | 2. |

Notes:
- Being an owner or operator does **not** give access to employee data; HR roles are assigned separately and only to HR staff who need them.
- If the Technical Owner also needs an HR role, the second operator must grant it (no one grants access to themselves).
- Management also signs the Real Data Go/No-Go together with the System Owner and the Technical Owner.

Could you reply with the names by [date]? IT will then need each operator's and HR admin's Entra account (object ID) — that part is in the IT request.

Thank you,
[HR Lead name]
