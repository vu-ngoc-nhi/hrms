# Legal Review Notes — Core HR S0–S3 (employee personal data)

> **Status: Pending Legal Review.** These are AI-assisted risk notes for design purposes. They are **not legal advice**, have not been reviewed by EmeSoft Legal or appointed counsel, and do not claim that the system "complies". Per C-03, development uses synthetic data only. Real employee data is a hard pre-production gate.
> Sources checked: 2026-10-07. Scope: data implemented in S0–S3, running locally on synthetic data. Hosting, vendors, backups and operations have not been assessed.

## 1. Sources and limits

During this work an automated research pass downloaded documents from official Government portals. The signed PDFs are scans, so they were read with OCR and summarized. Article references below must be verified by counsel before anyone relies on them.

| Instrument | Recorded status | Source |
|---|---|---|
| Law on Personal Data Protection No. 91/2025/QH15 | Effective 2026-01-01; listed as in force | [vanban.chinhphu.vn](https://vanban.chinhphu.vn/?pageid=27160&docid=214590&classid=1&typegroupid=3) |
| Decree 356/2025/ND-CP | Effective 2026-01-01 (Art. 42) | [vanban.chinhphu.vn](https://vanban.chinhphu.vn/?docid=216387&pageid=27160) |
| Decree 13/2023/ND-CP | Ceased effect 2026-01-01 (Art. 42.2, Decree 356); consents obtained under it remain usable (Art. 39, Law 91) | as above |
| Labour Code 2019, Art. 12 (labour management book) | In force; an amendment is still a draft | [vanban.chinhphu.vn](https://vanban.chinhphu.vn/?pageid=27160&docid=198540) |
| Decree 145/2020/ND-CP, Art. 3 | In force; a 07/2026 draft amendment is not adopted | [vanban.chinhphu.vn](https://vanban.chinhphu.vn/?pageid=27160&docid=201967) |

**Not verified:**
- statutory minimum retention periods for HR records or the labour management book of a private employer;
- whether the company qualifies as a small enterprise;
- the 2026 sanctions decree;
- the classification of tax code, social insurance number, email and bank account number as "basic" data. The decree does not name these fields, so this is inferred from its wording.

## 2. Data groups implemented in S0–S3

"Legal classification" (Art. 3–4, Decree 356) is kept separate from the internal security level. "Needed?" refers to the product rule, not to a legal obligation. A field appearing in the legacy Excel file does not justify collecting it.

| Group / fields | Purpose (HR/Product to confirm) | Needed? | Legal classification | Internal level | Processing basis | Access / export | Retention |
|---|---|---|---|---|---|---|---|
| Full name, employee code | Identify the record; workforce administration | Operational rule (M-04) | Basic | Directory | **Pending Legal Review** | HR_ADMIN, HR_EDITOR; no export yet | Codes kept in the registry so they are never reused; name: **Pending Legal Review** |
| Date of birth, gender | Workforce administration | Optional (not in M-04) | Basic | Personal | **Pending Legal Review** | HR_ADMIN, HR_EDITOR | **Pending Legal Review** |
| Mobile phone, personal email | Contact | Optional | Basic (email inferred) | Personal | **Pending Legal Review** | HR_ADMIN, HR_EDITOR | **Pending Legal Review** |
| Employment periods, work email, assignments (department, job title, employee type, level, manager) | Organize work | Operational rule | Basic | Directory | **Pending Legal Review** | HR roles | Business history; period **Pending Legal Review** |
| Audit (actor, field names) | Traceability, security | Yes | Linkable to a person, not anonymous | Technical | **Pending Legal Review** | No read API yet | **Pending Legal Review** |
| Login account (tenant/object id) | Authentication | Yes | To be confirmed | Technical | **Pending Legal Review** | Not exported | **Pending Legal Review** |

**Not implemented and rejected by the API:**
- legal ID, passport, tax, social insurance;
- bank;
- dependants and children;
- health and ID images;
- salary and contracts;
- addresses.

## 3. Risk notes (design priority, not an assessment of penalties)

| ID | Risk | Basis (to be verified by counsel) | Current mitigation | Decision needed |
|---|---|---|---|---|
| PL-01 (High) | Keeping all data indefinitely, or deleting everything at termination | Law 91 Art. 25.2: employee data is kept for the period set by law or agreement and deleted when the contract ends, unless agreed or provided otherwise. Labour Code Art. 12 and Decree 145 Art. 3 require a labour management book. **Specific periods: not verified.** | History is separate from personal payload; audit holds no values; no mass delete; idempotency stores an HMAC only | Retention schedule per data group, confirmed by counsel |
| PL-02 (High) | Real data on cloud/AI or unassessed vendors | Law 91 Art. 30 (purpose limitation, security, access control for cloud/AI processing); Decree 356 Art. 12 per research: cloud contract terms, encryption at rest and in transit. Law 91 Art. 20.6.b only exempts the *cross-border transfer* impact assessment for employee data stored on cloud. | Synthetic data only; docs page has no telemetry or external requests; logs carry no payloads or tokens. **No application-level encryption yet.** | Hosting/vendor list, encryption, processor contracts |
| PL-03 (Medium → High if enabled) | Collecting every legacy Excel field | Decree 356 Art. 4: health data, ID card images, and bank card or login data are sensitive. Children's data has specific rules (Law 91 Art. 24, per research). Consent must be per purpose (Law 91 Art. 9). | API rejects these groups; no role has `employees.read_sensitive` | Enable each group only with a purpose, basis, encryption and access rules |
| PL-04 (Medium) | Assuming an exemption from the impact assessment | Decree 356 Art. 41: optional 5-year relief for small enterprises and start-ups, **not** available to those that directly process sensitive data. The dossier is due within 60 days of starting processing (per research). Small-enterprise status: **not verified**. | — | Counsel determines applicability and owner |
| PL-05 (Medium) | Processing basis, notices and data-subject requests | Law 91 Art. 9, 19.1, and data-subject rights articles; Decree 356 Art. 5 response deadlines (per research). | — | Basis per field, employee notice, request process |
| PL-07 (Medium, before real classification) | Classifying Intern / Service Contractor / Collaborator relationships; for interns also agreement requirements, duration limits and allowance/pay | Whether an arrangement is in substance an employment relationship depends on law and facts, not on labels or contract titles. The EmeSoft Intern business definition (C-19) is not a legal classification. **Not verified.** | Employee Type is relationship-based and separate from Contract Type (C-13); no automatic legacy mapping (C-15) | Counsel confirms classification criteria |
| PL-08 (Medium, before a probation module) | Vietnam probation rules | Labour Code probation provisions (maximum durations, extension, pay, result notification). **Not verified; nothing encoded.** | Probation approved only as a concept (C-17) | Counsel confirms the rules before PV-16 |
| PL-09 (Medium, before real data) | Legal interpretation of End Reasons | The MVP End Reason codes (C-21) are a product classification; statutory termination grounds, notice and documentation obligations are not mapped. **Not verified.** | Codes are not presented as legal grounds | Counsel confirms the mapping before real use |
| PL-06 (Low for now) | Treating HRMS as the statutory labour management book | Labour Code Art. 12 and Decree 145 Art. 3 require contents not present in S0–S3 | Not claimed | Scope decision |

## 4. Gate before real employee data
Each item needs a named owner. EmeSoft Legal or appointed counsel must confirm items 1–4.
1. PL-01: retention schedule.
2. PL-02: hosting, vendors, encryption and contracts.
3. PL-04: impact-assessment applicability and owner.
4. PL-05: processing basis, notices and request process.
5. C-04: real Entra sign-in replaces the test issuer.
6. Proxy and access logs must not record query strings (search terms).
