# Mini HRS — IT Input Request 01 (DRAFT — NOT SENT)

- Date: 2026-10-12. Tracks 2 (hosting / infrastructure — Management / IT), 3 (Entra — IT) and 4 (ownership / access — Management). Draft for the Technical Owner / HR Lead to send to IT; **not sent, nothing configured.**
- Background and reasons for every item: `it-pre-production-handoff.md` (IDs below match it). Status map: `gate-a-readiness-status.md`.
- Please answer in the "Answer" column (or "not yet — expected by <date>"). **Never put a password, key or secret in this form**; give only where it is stored and who holds it.
- Synthetic data only. No real employee data enters any environment before the signed Real-Data Go/No-Go (A8).

## 1. Hosting and platform (Management decides IT-01; IT the rest)

| ID | Question | Answer |
|---|---|---|
| IT-01 | Hosting platform: on-premise or cloud? Provider, country/region, managed PostgreSQL or own server. (Also needed by counsel, Q-L5.) | |
| IT-02 | Staging: where, how isolated from production, lifetime (permanent or temporary for rehearsals)? | |
| H4 | Application runtime for one Node.js 24 process (VM, container, PaaS)? | |
| H5 | PostgreSQL **18**: version, storage encryption, point-in-time recovery available? | |
| IT-07 | Is the Mini HRS database dedicated to Mini HRS? Does anything rely on PUBLIC `TEMP` / `CREATE` there (our migration revokes them)? | |
| IT-03 | Network: confirm the database is **not** internet-reachable; which hosts may connect (app host, migration/operator machine); TLS to the DB or private network? | |
| IT-04 | DNS names and TLS certificates for staging and production; who renews them? | |
| IT-05 | Secret store: product, who can read which secret (DB logins, `IDEMPOTENCY_HMAC_KEY`, operator logins)? | |
| IT-06 | Reverse proxy: confirm access logs **exclude query strings** and the proxy adds **no CORS headers** and does not override the app's security headers (`security-headers.md`) | |
| IT-09 | Migration authority: who holds the schema-owner login; can it create roles and `SET ROLE hrms_access_function_owner`, or will IT pre-create the two NOLOGIN roles (runbook §2)? | |
| IT-14 | Read-only database login for the integrity scan: approach and holder | |

## 2. Backup and restore (A5; targets RPO ≤ 4 h, RTO ≤ 1 business day — provisional, PV-27)

| ID | Question | Answer |
|---|---|---|
| B1 | Backup method (managed snapshots / PITR, `pg_dump`, WAL archiving) | |
| B2 | Frequency or PITR window — does it meet RPO ≤ 4 h? | |
| B3 | Encryption at rest / in transit; who holds the key? | |
| B4 | Storage location, separate from the DB host, same approved jurisdiction | |
| B5 | Who can read / restore backups (production restore needs Management + HR System Owner approval) | |
| B6 | Failure alert: to whom, by what channel | |
| B7 | Restore procedure and **expected restore duration** — within 1 business day? | |
| B8 | Retention proposal (final value waits for counsel, Q-L4) | |
| PV-27 | Confirm RPO ≤ 4 h / RTO ≤ 1 business day are achievable, or propose other values with reasons | |

## 3. Entra non-production (A3; IT-08 / PV-11) — browser sign-in work starts only when E1–E5 arrive

| ID | Question | Answer |
|---|---|---|
| E1 | Tenant ID | |
| E2 | SPA / application registration: client ID, platform type, staging redirect URI, post-logout URI | |
| E3 | API / resource registration: client ID (= expected `aud`), exposed scope (`access_as_user` expected), confirmation that **v2** tokens are issued (`api.requestedAccessTokenVersion = 2`) | |
| E4 | Admin consent for the scope granted? | |
| E5 | Issuer confirmed as `https://login.microsoftonline.com/<tenant-id>/v2.0` | |
| — | Topology: two registrations (recommended) or an equivalent design — which? | |
| E6 | MFA / Conditional Access applied to the app? | |
| E7 | "Assignment required": now or later (recommended later — the app already refuses unknown accounts) | |
| E8 | Who disables accounts and how fast; token lifetime / sign-in frequency policy | |
| E9 | 2–3 non-production test accounts (synthetic people) and their object IDs | |
| E10 | Owner / contact for Entra configuration changes | |

## 4. Ownership and access operators (A4; Management names, IT provisions)

| ID | Question | Answer |
|---|---|---|
| PV-26 | System Owner (HR) — name | |
| PV-26 / P1 | Technical Owner — name | |
| PV-26 | Primary HR administrator — name and Entra object ID | |
| PV-26 | Backup HR administrator — name and Entra object ID | |
| P2 | Access operators (maximum two) — names | |
| P3 | PostgreSQL login per operator (personal, e.g. `op_<name>`, `CONNECT` only) | |
| P4 | Entra object ID of each operator | |
| P5 / IT-11 | Approved machine(s) for the access command and migrations | |
| P6 | Where operator credentials are stored | |
| P7–P9 / IT-12 | Who registers / deactivates operators and revokes logins when duties change | |

## 5. Coordinated staging rehearsal — what must exist before it is scheduled

One session, synthetic data only, run by the Technical Owner with IT; evidence recorded per `gate-a-readiness-status.md` §A3–A7:

1. production-like staging start (`APP_ENV=production`, `NODE_ENV=production`; the app refuses to start with any development value);
2. attended migration from an empty database (all migrations, function-owner path);
3. real non-production Entra sign-in / sign-out;
4. rejection and security cases (v1 token, wrong audience, missing scope, other tenant, `/api/v1/dev/*` → 404, headers present, proxy logs clean);
5. access administration (environment record, operator, bootstrap two HR admins, assign/remove, disable/enable, last-admin and self-grant refusals, audit rows);
6. application health (`/health`);
7. integrity scan (read-only login) 0/0;
8. backup;
9. restore into a new instance, timed against the RTO;
10. post-restore verification (counts, migration list, integrity 0/0, access audit, app smoke).

Prerequisites: §1 IT-01…IT-07 and IT-09, §2 B1–B7, §3 E1–E6 and E9, §4 named operators with logins. Until then nothing is run on staging.
