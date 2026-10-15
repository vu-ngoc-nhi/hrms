# Eme People — Backup / Restore Rehearsal Record (TEMPLATE)

- Gate A5. **Template — closes nothing until filled with a passing rehearsal and signed.** Synthetic data only, on staging. Basis: readiness plan Appendix C.3 and `gate-a-readiness-status.md` §A5.2.
- Targets (provisional, M-14 / PV-27): **RPO ≤ 4 h, RTO ≤ 1 business day.** A rehearsal that needed improvisation **fails**.

## 1. Context

| Field | Value |
|---|---|
| Date / environment | / staging |
| Backup method and tool (IT B1) | |
| Backup frequency / PITR window (IT B2) | |
| Encryption and key holder (IT B3) | |
| Storage location (IT B4) | |
| Operator(s) | |
| Witness (Technical Owner or delegate) | |
| App tag / commit | |

## 2. Before backup — baseline (synthetic dataset loaded)

Dataset must include: several people; an ended period; a reversed End; a cancelled planned period; a voided period; a cancelled planned assignment; at least one correction with reason; access-administration users, roles and audit rows.

| Evidence | Value |
|---|---|
| Row counts per table (attach query output) | |
| `_prisma_migrations` list (names + count) | |
| `max(revision)` for 3 sampled people (ids only) | |
| Access audit row count | |
| Integrity scan result (read-only login) | Errors __ · Warnings __ |
| Time of last write before backup | |

## 3. Backup

| Evidence | Value |
|---|---|
| Backup id / timestamp | |
| Backup size | |
| Stored where; access limited to | |
| Failure alert test: fired at / received by / at | |

## 4. Restore (into a **new** instance — never over the only copy)

| Step | Time | Result |
|---|---|---|
| Restore started | | |
| Restore finished | | |
| App pointed at the restored database (config change only) | | |
| **Elapsed restore time** (target ≤ 1 business day) | | |
| Data window lost vs RPO (time of last write − backup point) | | |

## 5. After restore — verification

| # | Check | Expected | Result |
|---|---|---|---|
| 1 | Row counts per table | Identical to §2 | |
| 2 | `_prisma_migrations` list | Identical; `npx prisma migrate status` up to date | |
| 3 | `max(revision)` samples | Identical | |
| 4 | Integrity scan | 0 errors | |
| 5 | Access audit rows | Identical count; latest rows readable | |
| 6 | Access routines owner | All `public.access_*` owned by `hrms_access_function_owner` | |
| 7 | App: Entra sign-in | Works | |
| 8 | App: open a person with a voided period | Voided badge; history order correct | |
| 9 | App: save a change with `expected_revision` | Saved; revision +1; audit entry present | |
| 10 | Grants | `hrms_app` still read-only on accounts; no DML for operators (`it-pre-production-handoff.md` §4) | |

## 6. Outcome

| Field | Value |
|---|---|
| Procedure followed without improvisation | Yes / No |
| All checks identical / passing | Yes / No |
| Elapsed time ≤ RTO | Yes / No |
| **Result** | **PASS / FAIL** |
| Deviations and follow-ups | |
| Signed — Technical Owner (name, date) | |
| Received — IT (name, date) | |
