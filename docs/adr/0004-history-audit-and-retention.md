# ADR-0004 — Business history, audit and data retention

- Status: **MVP Decision** (M-07). Retention periods: **Pending Legal Review** (PL-01).

## Decision
1. **Business history is separate from personal payload.**
   - Employment periods, employment events and effective-dated assignments are business history.
   - Personal attributes on `person` will get their own retention and deletion policy.
   - Nothing is designed to keep every field forever, and nothing deletes everything automatically when an employee leaves.
2. **Audit stores no profile values**, only actor, action, outcome, entity, request id and the *names* of changed fields. UUIDs and field names are still linkable to a person, so audit data is **not** anonymous.
3. **Idempotency** keeps a keyed HMAC of the payload (never the payload itself) and the resource id for 24 hours. This is a product choice; an automated cleanup job is still to be built.
4. **Excel staging** (planned) expires after 72 hours, and payloads are removed once processing completes. This is a product choice, not a legal period.
5. **No delete API** for profiles in this phase, and the app role cannot delete from `person`, `employment` or `job_assignment`. Retention-driven deletion or anonymization will be a separate, privileged process, designed after PL-01 is resolved.
6. **Profile revision**: every transaction that changes a person or its child data will increment `person.revision` under a row lock. S3 only creates profiles (revision 1); PATCH with `expected_revision` is planned for S4.
7. **Completeness is computed, not stored** (M-04). `person.profile_state` is deprecated (nullable, unused) and is kept in this iteration (C-12). It will be dropped only after the computed model has been stable, all dependencies have been verified, and the drop has been explicitly approved.
8. **Relationship history vs. correction** (C-09, revised 2026-10-09): a genuine relationship change is a new employment period. A data-entry correction updates the existing period in place, done by an authorized user with a reason (S4). The database no longer blocks in-place changes (forward migration `20261009000000`). A later audit table (changed_by, changed_at, old_value, new_value, reason) can record corrections without changing this model.

## Pending Legal Review
- Retention per data group and its basis; reviewer; handling of backups.
- Audit retention period.
- The data-subject request process (access, correction, deletion, withdrawal of consent).
