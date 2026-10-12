# Mini HRS — Legal / Privacy Question Pack 01 (DRAFT — NOT SENT)

- Status: **draft prepared by engineering on 2026-10-12; not sent.** The HR Lead reviews, completes the bracketed fields and sends it to counsel (Track 1, C-88). Sending is recorded in the decision register with the date and the counsel contact.
- Engineering has **not** answered any question and draws no legal conclusion. Statutory references are given only as pointers for counsel to verify.
- Gate effect: none. Gate A1 closes only on counsel's written answers (`docs/production/gate-a-readiness-status.md` §A1).

---

## Cover note (for the HR Lead to send)

> To: [counsel name / firm]  From: [HR Lead], EmeSoft  Date: [date]  Requested reply by: [date]
>
> EmeSoft is preparing to use an internal HR records system ("Mini HRS") for its own employees (about 70–100 people). Before any real employee data is entered, we need your written advice on the questions below. The system is currently used only with synthetic test data. Please answer each question separately; where an answer depends on facts we have not yet given (for example the hosting provider), please say what you need.

## 1. Facts about the system (for counsel)

| Item | Fact |
|---|---|
| Controller | EmeSoft [legal entity name, address] |
| Purpose | Internal workforce administration: who works for EmeSoft, in which employment relationship, since when, in which department / job title / level, reporting to whom; company e-mail; history of changes |
| Users | HR staff only (~2–10 accounts) with two roles: **HR Admin** (all actions incl. corrections) and **HR Editor** (day-to-day records). Employees do not use the system |
| Sign-in | Microsoft Entra ID company accounts; multi-factor authentication expected through the company tenant policy [IT to confirm, E6] |
| Hosting | **[pending Management / IT decision IT-01: provider, country/region, managed service or own server]** |
| Data volume | ~100 current and former employees at first load |
| Export / reporting | None. No export, no reports, no integration with payroll or other systems |
| AI / analytics | None. No personal data is sent to AI services |
| Change history | Every change records who changed which field, when and why (reason where required). Old/new values are kept only for structural fields (employee type, department, job title, level, period and assignment dates); never for name, date of birth, gender, phone or e-mail addresses |
| Deletion | No record is hard-deleted; erroneous records are marked (cancelled / voided) and kept as evidence. No automatic deletion or anonymisation exists yet |
| Backups | Planned: encrypted, at least every 4 hours or continuous, stored separately from the database; retention to be set from your answer to Q-L4 |

### Annex A — data groups processed

| Group | Fields | Required by the system? |
|---|---|---|
| Identity | Full name, employee code | Yes |
| Personal | Date of birth, gender | No (optional) |
| Contact | Mobile phone, personal e-mail | No (optional) |
| Employment | Employment periods (start/end dates, employee type such as employee / intern / service contractor, end reason), work e-mail, assignments (department, job title, level, manager) | Yes (start date, employee type, department, job title) |
| Audit | Who changed which field of which record, when and why; old/new values for structural fields only (see §1) | Yes (automatic) |
| Login | Entra tenant id and object id of HR users | Yes (HR users only) |

**Not collected (the system rejects them):** national ID / passport / tax / social-insurance numbers, bank details, dependants and children, health data, ID images, salary and contracts, home addresses.

### Annex B — End Reason categories (product classification, not legal grounds)

Voluntary Resignation · Employer-initiated End · Planned Term Completed · Mutual Agreement · Probation Not Passed · Other (note required) · Relationship Change (system-only, when a person moves from one employment relationship to another).

---

## 2. Questions

Classification: **Required before real data** = Mini HRS will not hold real employee data until answered. **Required before go-live** = needed before HR relies on the system. **Scoping** = please also advise whether it must be resolved before real data.

| # | Topic | Classification | Question |
|---|---|---|---|
| Q-L1 | Lawful basis and employee notice | Required before real data | For each data group in Annex A, what is the lawful basis under Law 91/2025/QH15 and Decree 356/2025/ND-CP, and must employees receive a specific notice or give consent? Are the optional groups (date of birth, gender, mobile phone, personal e-mail) appropriate to collect at all for this purpose? Please provide or approve the notice text and the delivery method. |
| Q-L2 | Retention, including former employees | Required before real data | What retention period applies to each data group in Annex A, before and after an employee leaves EmeSoft, and what must happen at the end of the period (deletion, anonymisation, archive)? Do statutory minimum periods (e.g. Labour Code Art. 12, Decree 145/2020 Art. 3) override Law 91 Art. 25.2? |
| Q-L3 | Audit-log retention | Not blocking (kept meanwhile) | The audit log records who changed which field of which record, when and why, with old/new values only for structural fields (employee type, department, job title, level, dates — never personal or contact fields); a separate log records changes to HR users' access. How long may or must these logs be kept, and are they subject to the same deletion obligations as the HR record? |
| Q-L4 | Backup retention | Required before real data | When personal data must be deleted, may it remain in encrypted backups until those backups expire, and what maximum backup retention is acceptable? |
| Q-L5 | Hosting / vendor / cross-border | Required before real data | If the system is hosted at **[provider / on-premise, country/region]**, what contractual terms (processor agreement), security measures (encryption at rest and in transit) and cross-border considerations apply? Is any filing or notification required? |
| Q-L6 | Impact assessment | Required before real data | Must EmeSoft prepare a personal-data processing impact assessment for this system? Does any small-enterprise relief apply, given that no sensitive data is processed? Who must own it, and by when must it be filed? |
| Q-L7 | HR access to personal fields | Required before real data | Is it acceptable that HR staff with the "HR Editor" role (day-to-day HR operations) can view employees' date of birth, gender, mobile phone and personal e-mail, or must access be restricted further? |
| Q-L8 | Data-subject requests | Required before go-live | What process and response deadlines apply to employee requests to access, correct or delete their data, and which requests may be refused because of other legal obligations? |
| Q-L12 | Relationship classification and End Reasons | Scoping — decision by Legal / Management | Which criteria determine whether an intern or service-contractor arrangement is legally an employment relationship? How do the End Reason categories in Annex B relate to statutory termination grounds? **Please also advise whether either point must be settled before real records are entered**, or only before statutory reporting. |

Not asked now: data export (no export exists), sensitive / identity-document data (rejected by the system), the system as the statutory labour management book (not claimed), probation rules (no probation feature).

## 3. Response form (one per question)

| Field | Answer |
|---|---|
| Question | Q-L_ |
| Answer / requirement | |
| Required action for EmeSoft (notice, contract, filing, configuration) | |
| Deadline or trigger | |
| Blocks real data? (counsel's view) | Yes / No |
| Sources relied on | |
| Counsel, date | |

## 4. After the answers arrive (engineering, not counsel)

Each answer is recorded in `docs/decision-register.md` (PL-01, PL-02, PL-04, PL-05, Q-L7, PV-28 H, Q-L12) by the HR Lead with the counsel reference. Any change it requires to the system (fields, access, retention, notice) is a separate, approved change; nothing is changed by assumption.
