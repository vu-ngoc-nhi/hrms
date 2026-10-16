# PV-39 — Renewal semantics decision gate (Slice 2A-5)

- Status: **Revision 3 (2026-10-16) — approved; slice 2A-5 authorized** with two final clarifications: (1) **Cancel Planned is contract-wide** (§7 applies to every contract, refining C-107); (2) the forward migration **validates existing renewal rows** and fails only on data that actually violates the approved model — it does not fail merely because renewal rows exist (§11). Terminology: **one non-disposed direct renewal per parent agreement** (disposed = Discarded, Cancelled, Voided). Amendment stays gated (PL-12 / PV-38).
- Revision 1 (same day) was accepted with changes: renewal chains allowed; open-ended contracts not renewable; overlap warns; **only a Signed renewal** affects the parent's projection and reminders; Cancel Planned only for Finalized-unsigned future contracts (Signed withdrawal = PL-10); parent cancel/void blocked while a renewal exists; terminology "one non-disposed direct renewal per parent agreement".
- Unchanged from earlier decisions: renewal = a new agreement linked by `parent_contract_id` + `relationship_type = 'renewal'`, the parent is never modified (C-104); same Employment Period (composite FK); Contract Number required before Finalize and never reused (M-15, M-18); past-dated registration with `contracts.finalize` (C-109); Voided period read-only (C-111); M-19 warning confirmation.

## 1. Renewal-chain semantics

- A renewal **is an agreement**. It may itself be renewed later: **A → B → C**.
- The parent of a renewal is an **original agreement or another renewal agreement — never an Amendment** (amendments are not admitted in the database yet; the rule stays for when they are).
- **No branching:** each agreement has at most one non-disposed direct renewal (§3). While B is non-disposed, A cannot create another renewal; the next renewal is created from B (A → B → C). If B is later disposed, A may create a replacement renewal.
- Lineage is explicit and immutable (`parent_contract_id` never changes after insert, existing trigger).

## 2. Renewable parent

A contract may be renewed only when **all** hold:

1. it is **Finalized or Signed** (a Draft cannot be renewed);
2. it is **not Discarded, Cancelled or Voided**;
3. it has a **finite term** — an Effective To date. **Open-ended contracts are not renewable** in MVP (no Renew action is offered; no amendment / new-agreement substitute is invented here);
4. it has **no non-disposed direct renewal**;
5. its Employment Period is not Cancelled or Voided (the renewal is created in the **same** period).

Its time state does not matter: **Upcoming, Active and Expired parents may be renewed.**

## 3. Invariant — one non-disposed direct renewal per parent agreement

- **Disposed** = the child renewal is **Discarded** (a Draft cancelled, `cancelled_at`), **Cancelled** (a planned contract cancelled, `cancelled_at`) or **Voided** (`voided_at`).
- **Non-disposed** = Draft, Finalized or Signed.
- At most one non-disposed child with `relationship_type = 'renewal'` per parent — enforced by the existing partial unique index, renamed to `contract_one_nondisposed_renewal_uq` (§11). A second attempt → 409 `RENEWAL_EXISTS` (link to the existing renewal).
- A disposed renewal frees the parent; its Contract Number stays occupied (M-18).

## 4. Draft vs Finalized vs Signed renewal — effect on the parent

| Renewal state | Parent operational projection | Parent in Expiring Soon | Renewal itself |
|---|---|---|---|
| none | own Effective To / period end | normal rules (M-20) | — |
| **Draft** | **no effect** | **yes** (no successor confirmed) | not a reminder (drafts never are, M-20) |
| **Finalized, not signed** | **no effect** — Finalized does not mean confirmed | **yes** | **Awaiting signature** |
| **Signed** (non-disposed) | the **confirmed successor**: parent operational end = least(own Effective To, period end, **renewal Effective From − 1**) — "Replaced by renewal" | **no** (suppressed) | no reminder |

- The parent's **stored** Effective To is never changed; stored dates remain business facts. The derived end is computed on read.
- A disposed renewal has no effect at any stage; everything recomputes automatically.

*This supersedes the earlier rule (C-104 / 2A-2 code) that a Finalized renewal already ended the parent's term and removed it from Expiring Soon.*

## 5. Renewal Effective From — gaps and overlaps

- **Default:** parent Effective To + 1 day (Asia/Ho_Chi_Minh business dates). HR may edit it.
- **Hard rules (block):** inside the same Employment Period (existing rule) and **after the parent's Effective From** (`contract_renewal_starts_after_parent`).
- **Gap** (renewal starts after parent Effective To + 1): **allowed + warning** `GAP_AFTER_PREDECESSOR` → Needs Review; Finalize needs the M-19 confirmation.
- **Overlap** (renewal starts on or before parent Effective To): **allowed + warning** — new code **`RENEWAL_OVERLAPS_PREDECESSOR`** → Needs Review; Finalize needs the M-19 confirmation. *Supersedes the earlier "intended replacement, no warning".* The stored parent Effective To is not changed; only a **Signed** renewal derives the parent's operational end (§4).
- Both warnings stay in Needs Review **while the condition holds** (they are date facts), also after the renewal is signed, until the dates are corrected or the condition no longer applies.
- Contract Type is **prefilled from the parent**, editable; **no** invariant requires the same type. Changing the type never changes Employee Type or the Employment Period, and the renewal logic attaches no legal meaning to the type. Contract Number is never prefilled (no auto-numbering).

## 6. Reminder behaviour (Home Contract Attention, unchanged three signals)

| Situation | Expiring Soon | Awaiting signature | Needs review |
|---|---|---|---|
| No renewal | parent per M-20 | parent if Finalized-unsigned | parent's own conditions |
| Draft renewal | **parent stays** | — | renewal draft only if its period lost validity |
| Finalized-unsigned renewal | **parent stays** | **renewal appears** | gap / overlap warnings on the renewal |
| Signed renewal | **parent suppressed** | — | gap / overlap warnings remain while true |

**No Home "Renewal draft" signal or count.** A small contextual note ("Renewal draft exists") may later appear on the contract detail / list, never as a Home card.

## 7. Cancellation semantics

| Contract (renewal or any contract) | Action |
|---|---|
| **Draft** | **Discard** (existing). |
| **Finalized, not signed, Effective From > Vietnam today** | **Cancel planned** (2A-5; `contracts.finalize`, mandatory reason). Final for that record; the parent is not modified. |
| **Signed, Effective From in the future** | **No normal Cancel planned.** Withdrawing a signed contract is **PL-10 — LEGAL INPUT REQUIRED**. |
| **Effective From today or in the past** | **No Cancel planned** (it has taken effect). |

*This narrows C-107 / ADR-0005 §6, which allowed Cancel planned for Finalized **or Signed** upcoming contracts.*

## 8. Void boundary

- **Void** is only for an **erroneous / invalid record** — a contract that should never have existed (C-107). It is **not** the way to stop a valid contract or renewal that has begun.
- Early termination of a valid contract, if the business needs it, is a **separate lifecycle action** to be defined later (not in 2A-5).
- **Parent with a non-disposed renewal child:** the parent **cannot be Cancelled or Voided** (and, already, cannot Return to Draft) until the child is dealt with. No cascade; once the child is disposed, the parent is re-evaluated normally.

## 9. Employment Period behaviour

| Period | Renewal |
|---|---|
| Active / Pre-start | Normal rules. |
| **Ended** | Historical registration allowed **only when the renewal Effective From lies inside the period coverage**; no future renewal outside an Ended period. |
| **Cancelled / Voided** | **Refused** (existing period-validity rules; Voided is read-only). |
| **Rehire** | New Employment Period → **new contract**. **Never a renewal across Employment Periods** (same-period FK). |

## 10. Remaining Legal inputs

- **PL-12:** statutory renewal limits and conversion to open-ended contracts; legal implications of gaps and overlaps; early replacement of a running fixed-term contract; Contract Type / legal classification implications.
- **PL-10:** withdrawing or cancelling an already **Signed** contract or renewal.

No statutory limit is encoded by assumption.

## 11. Exact forward migration (to be created only when 2A-5 is authorized)

File `prisma/migrations/<YYYYMMDDhhmmss>_contract_renewal_chains/migration.sql` — forward-only, additive, no data change (no renewal rows exist; verified by a guard at the top of the migration):

```sql
-- PV-39 / C-115: renewal chains, renewable-parent rules, parent disposition guard, invariant naming.
-- Forward-only. Replaces the 2A-1 rule "the parent of a renewal has no parent itself", which blocked A → B → C.

-- Validate existing renewal rows against the approved model; fail ONLY on incompatible data (branching, amendment or
-- cross-period parent, disposed or non-renewable parent of a non-disposed renewal, renewal not starting after its parent).
-- Compatible pre-existing renewal rows are accepted. (Final SQL: the 2A-5 migration file.)
CREATE FUNCTION contract_renewal_model_violations() RETURNS TABLE (contract_id uuid, violation text) …;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM contract_renewal_model_violations()) THEN
    RAISE EXCEPTION 'existing renewal rows violate the approved renewal model';
  END IF;
END $$;

-- (1) Invariant naming: one non-disposed direct renewal per parent agreement (definition unchanged).
ALTER INDEX contract_one_live_renewal_uq RENAME TO contract_one_nondisposed_renewal_uq;

-- (2) Structural rules: same body as 2A-1 except the parent block.
CREATE OR REPLACE FUNCTION contract_structural_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  p_start date;
  p_end date;
  p_cancelled timestamptz;
  p_voided timestamptz;
  check_dates boolean;
  check_validity boolean;
  parent contract%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.parent_contract_id IS DISTINCT FROM OLD.parent_contract_id OR NEW.relationship_type IS DISTINCT FROM OLD.relationship_type THEN
      RAISE EXCEPTION 'the relationship of a contract cannot be changed (constraint "contract_link_immutable")'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'contract_link_immutable';
    END IF;
    IF OLD.finalized_at IS NOT NULL AND NEW.employment_id IS DISTINCT FROM OLD.employment_id THEN
      RAISE EXCEPTION 'the employment period of a finalized contract cannot be changed (constraint "contract_employment_fixed_after_finalize")'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'contract_employment_fixed_after_finalize';
    END IF;
  END IF;

  IF NEW.parent_contract_id IS NOT NULL THEN
    -- Read-locked so a concurrent Return to Draft / Cancel / Void of the parent serializes with this write.
    SELECT * INTO parent FROM contract WHERE id = NEW.parent_contract_id FOR SHARE;
    IF TG_OP = 'INSERT' THEN
      -- Any agreement (original or renewal) may be renewed; an amendment never.
      IF parent.relationship_type = 'amendment' THEN
        RAISE EXCEPTION 'the parent of a renewal must be an agreement (constraint "contract_parent_is_agreement")'
          USING ERRCODE = 'check_violation', CONSTRAINT = 'contract_parent_is_agreement';
      END IF;
      -- Renewable parent: Finalized or Signed, not disposed, finite term.
      IF parent.finalized_at IS NULL OR parent.cancelled_at IS NOT NULL OR parent.voided_at IS NOT NULL
         OR parent.is_open_ended OR parent.effective_to IS NULL THEN
        RAISE EXCEPTION 'the parent contract cannot be renewed (constraint "contract_parent_renewable")'
          USING ERRCODE = 'check_violation', CONSTRAINT = 'contract_parent_renewable';
      END IF;
    END IF;
    -- A renewal starts after the contract it renews (checked whenever its Effective From is written or it is finalized).
    IF NEW.effective_from IS NOT NULL AND parent.effective_from IS NOT NULL AND NEW.effective_from <= parent.effective_from
       AND (TG_OP = 'INSERT' OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
            OR (OLD.finalized_at IS NULL AND NEW.finalized_at IS NOT NULL)) THEN
      RAISE EXCEPTION 'a renewal must start after its parent (constraint "contract_renewal_starts_after_parent")'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'contract_renewal_starts_after_parent';
    END IF;
  END IF;

  check_validity := TG_OP = 'INSERT' OR (OLD.finalized_at IS NULL AND NEW.finalized_at IS NOT NULL)
                    OR NEW.employment_id IS DISTINCT FROM OLD.employment_id;
  check_dates := NEW.effective_from IS NOT NULL AND (
                   TG_OP = 'INSERT' OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
                   OR NEW.employment_id IS DISTINCT FROM OLD.employment_id
                   OR (OLD.finalized_at IS NULL AND NEW.finalized_at IS NOT NULL));
  IF check_validity OR check_dates THEN
    SELECT e.start_date, e.end_date, e.cancelled_at, e.voided_at INTO p_start, p_end, p_cancelled, p_voided
    FROM employment e WHERE e.id = NEW.employment_id FOR SHARE;
    IF check_validity AND (p_cancelled IS NOT NULL OR p_voided IS NOT NULL) THEN
      RAISE EXCEPTION 'the employment period is cancelled or voided (constraint "contract_period_valid")'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'contract_period_valid';
    END IF;
    IF check_dates AND (NEW.effective_from < p_start OR (p_end IS NOT NULL AND NEW.effective_from > p_end)) THEN
      RAISE EXCEPTION 'contract effective_from outside its employment period (constraint "contract_effective_from_within_period")'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'contract_effective_from_within_period';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- (3) A parent with a non-disposed direct renewal cannot be Cancelled, Voided or returned to Draft (no cascade).
CREATE FUNCTION contract_parent_with_renewal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ((OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL)
      OR (OLD.voided_at IS NULL AND NEW.voided_at IS NOT NULL)
      OR (OLD.finalized_at IS NOT NULL AND NEW.finalized_at IS NULL))
     AND EXISTS (SELECT 1 FROM contract c
                 WHERE c.parent_contract_id = OLD.id AND c.relationship_type = 'renewal'
                   AND c.cancelled_at IS NULL AND c.voided_at IS NULL) THEN
    RAISE EXCEPTION 'a contract with a non-disposed renewal cannot be cancelled, voided or returned to draft (constraint "contract_parent_has_renewal")'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'contract_parent_has_renewal';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contract_parent_with_renewal_guard_trg
  BEFORE UPDATE ON contract
  FOR EACH ROW EXECUTE FUNCTION contract_parent_with_renewal_guard();
```

Notes:
- `relationship_type` stays `CHECK (relationship_type IN ('renewal'))`; adding `amendment` is the amendment checkpoint's own migration.
- No column, grant or data change. Cycles stay impossible (the parent row exists before the child; links are immutable).
- Service/API counterparts in 2A-5: `createContractRenewal`, `createContractCancelPlanned`, `createContractVoid`, `createContractCorrection`; the new warning `RENEWAL_OVERLAPS_PREDECESSOR`; the evaluation change "only a Signed non-disposed renewal is the confirmed successor"; error mapping for the new constraints (`contract_parent_renewable` → 422 `PARENT_NOT_RENEWABLE`, `contract_renewal_starts_after_parent` → 422 `RENEWAL_STARTS_BEFORE_PARENT`, `contract_one_nondisposed_renewal_uq` → 409 `RENEWAL_EXISTS`, `contract_parent_has_renewal` → 409 `DEPENDENT_CONTRACTS_EXIST`).
- Tests that assert the 2A-1 behaviour ("the parent is an agreement, never another renewal") change with this migration.

## 12. History and relationship display

- Lineage **A → B → C** shown on Contract Detail as **Renews: <parent>** and **Renewed by: <child>** (with the child's document state).
- The parent receives one concise event when the renewal is created — **"Renewal draft created"** (`renewal_created`, linked) — and nothing else; the child's own events are not duplicated on the parent.
- Each renewal keeps its own lifecycle history.

## 13. Decision summary (C-115)

| # | Decision |
|---|---|
| 1 | Renewal chains A → B → C; parent = original or renewal agreement, never an amendment; no branching |
| 2 | Renewable parent: Finalized/Signed, not disposed, same period, finite term (Effective To), no non-disposed direct renewal; Upcoming / Active / Expired allowed; Drafts and open-ended contracts not renewable |
| 3 | Invariant "one non-disposed direct renewal per parent agreement"; disposed = Discarded, Cancelled or Voided |
| 4 | Only a **Signed** renewal is the confirmed successor (projection, Expiring Soon suppression); Draft and Finalized-unsigned renewals have no effect on the parent |
| 5 | Effective From default parent end + 1, editable; inside the period and after the parent's start (hard); gap and overlap allowed with warnings (Needs Review); stored parent dates never changed |
| 6 | Reminders as §6; no Home renewal signal |
| 7 | Cancel planned only for Finalized-unsigned contracts with Effective From after Vietnam today; Signed withdrawal = PL-10; nothing once started |
| 8 | Void only for erroneous records; parent with a non-disposed renewal cannot be Cancelled / Voided / returned to Draft; no cascade |
| 9 | Period rules as §9; never across Employment Periods |
| 10 | Contract Type prefilled, no same-type invariant, no legal meaning inferred |
| 11 | Parent event "Renewal draft created"; Renews / Renewed by display |

**STOP — 2A-5 implementation awaits a separate authorization.**
