# Package 02 — IT / Management submission e-mail (DRAFT — NOT SENT)

- Sender: HR Lead (until a Technical Owner is named). Recipients: IT lead; Management (for A and D).
- Attachment: `docs/production/it-input-request-01.md` (answer form; IDs match `it-pre-production-handoff.md`, which can be attached for background).
- Nothing is configured by Development; IT owns every change below. Sending closes nothing.

---

**Subject:** Mini HRS pre-production — IT and Management inputs needed (hosting decision is on the critical path)

Dear [IT lead], dear [Management],

Mini HRS (EmeSoft's internal HR records system) is functionally complete and tested with synthetic data only. Before any real employee data can be loaded, we need a secure environment, sign-in, backups and named people. The attached form lists every item with an answer column. **Please do not put any password or secret in the form** — only where it is stored and who holds it.

**Why hosting comes first.** The hosting decision (IT-01) blocks two separate tracks: IT cannot build staging, backups or DNS without it, and our legal counsel cannot answer the hosting/vendor question (Q-L5) without knowing the provider and region. It is the single most valuable decision right now.

**A. Hosting / platform decisions** (Management decides IT-01; IT the rest)
- IT-01 hosting: on-premise or cloud, provider, country/region.
- IT-02 staging approach (may be small or temporary, isolated from production).
- Runtime for one Node.js 24 process; PostgreSQL 18 with encrypted storage.
- IT-07 a database dedicated to Mini HRS (our migration revokes PUBLIC TEMP/CREATE on it).
- IT-03 database not reachable from the internet; IT-04 DNS + TLS for staging and production.
- IT-05 secret store; IT-06 proxy logs without query strings and no CORS headers.
- IT-09 who holds the schema-owner login and runs migrations; IT-14 read-only login for the integrity scan.

**B. Entra non-production inputs** (IT) — browser sign-in development starts only when E1–E5 arrive
- E1 tenant ID; E2 SPA registration (client ID, staging redirect / post-logout URIs); E3 API registration (client ID, scope `access_as_user`, v2 tokens); E4 admin consent; E5 issuer confirmation.
- E6 MFA / Conditional Access; E7 "assignment required" timing; E8 disable behaviour and token lifetime; E9 two or three synthetic test accounts; E10 Entra change contact.

**C. Backup / restore inputs** (IT)
- B1–B8: method, frequency or point-in-time recovery, encryption and key custody, separate storage location, access, failure alert, restore procedure and expected duration, retention proposal (final value waits for counsel).
- PV-27: confirm the provisional targets **RPO ≤ 4 hours, RTO ≤ 1 business day**, or propose other values with reasons. A backup is accepted only after a successful restore rehearsal.

**D. Access / operator provisioning** (Management names, IT provisions)
- Technical Owner and up to two access operators (names) — see the separate owner nomination request.
- Per operator: personal PostgreSQL login (`CONNECT` only), Entra object ID, approved machine, credential storage; who registers and revokes operators.

**What happens next.** Once A–D are answered, we run **one coordinated staging rehearsal** with synthetic data (start, migrate, Entra sign-in, rejection cases, access administration, health, integrity scan, backup, restore, post-restore check) — §5 of the form. Nothing is deployed to production before that rehearsal succeeds.

Could you reply with a target date for A (especially IT-01) and B first?

Thank you,
[name], EmeSoft
