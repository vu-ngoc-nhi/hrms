# Package 02 — HR internal onboarding request (DRAFT — NOT SENT)

- Sender: HR Lead (or the project lead on the HR Lead's behalf). Recipients: the HR team members who will prepare the first load.
- Reference: `docs/production/onboarding-mapping-template.md` and the header-only sheets in `docs/production/onboarding-templates/`.
- Decisions applied: one-time validated import utility (M-12); current operational truth + relevant earlier Employment Periods (M-13). Sending closes nothing; A7 closes on an approved mapping and a successful **synthetic** import rehearsal signed by HR.

---

**Subject:** Preparing Mini HRS's first data load — what HR needs to prepare (no real data enters the system yet)

Hi team,

Mini HRS is ready on the technical side. Before the first real load we need HR to prepare the reference lists and the mapping from our current Excel file. **Nothing you prepare will be loaded until the Real Data Go/No-Go is signed.** Development will rehearse the import using invented (synthetic) data in the same format.

**Please prepare**

| # | Item | Template / detail |
|---|---|---|
| 1 | **Departments** — code and English name | `departments.csv` |
| 2 | **Job Titles** — code, English name, official Vietnamese name where it applies | `job_titles.csv` |
| 3 | **Levels** — code, name, order | `job_levels.csv` |
| 4 | **Employee Types** — Employee, Service Contractor, Intern (the approved set) and whether each normally gets a company e-mail; for each person, the type follows the **actual working relationship**, never the old "CLASSIFY" column | `employee_types.csv` |
| 5 | **Source column mapping** — what the unclear Excel columns mean (L, S, T, M, R, G–I, AA–AC, AS–AV, BC) and, for each distinct value, Map / Transform / Discard / Needs Investigation | template §4 |
| 6 | **First-load population** — current employees only, or also people who have left (since which date) | template §5 |
| 7 | **Earlier Employment Periods to include** — only people whose history matters to read their record correctly: rehires, and intern → employee or contractor → employee changes | `employment_periods.csv`; template §2 |
| 8 | Employee Code format, how codes differing only by upper/lower case are resolved, prefix for new codes | template §5 |
| 9 | Company e-mail domain(s) | template §5 |
| 10 | Whether to load the optional personal fields (date of birth, gender, mobile, personal e-mail) — **wait for counsel's answer (Q-L1)** before deciding | template §5 |
| 11 | A second person to check the mapping | template §5 |

**Rules for the filled files (important)**

- Filled files contain **real employee data**. Keep them only in [approved HR storage location].
- **Do not** put them in Git, the project repository, tickets, chat channels, e-mail to Development, or **any AI tool** (including Claude) **before the Real Data Gate (A8) is signed**.
- Development needs only the **structure** (column names, codes, the decisions above) — never the real rows. If an example helps, invent one.
- Catalogs (departments, job titles, levels, types) are not personal data and can be shared with Development.

Target date for items 1–5 and 8–9: [date]. Questions to [contact].

Thank you,
[HR Lead name]
