-- PV-01 correction (2026-10-09). Forward migration; the committed baseline migration is not edited.
--
-- The baseline made employment.employee_type_id absolutely immutable once set. That also blocked authorized HR
-- users from correcting a data-entry mistake (e.g. "Service Contractor" selected by accident for an Employee).
--
-- Rule from now on (enforced in the application layer, S4):
--   * Real relationship change (e.g. Service Contractor -> Employee): close the period and start a NEW employment
--     period, so history is preserved.
--   * Data correction: update the existing period's employee_type_id in place, by an authorized user with a reason.
-- A future audit trail (changed_by, changed_at, old_value, new_value, reason) can be added without schema conflicts.
--
-- Non-destructive: removes a trigger and its function only; no table, column or row is changed.
DROP TRIGGER IF EXISTS employment_employee_type_immutable_trg ON employment;
DROP FUNCTION IF EXISTS employment_employee_type_immutable();
