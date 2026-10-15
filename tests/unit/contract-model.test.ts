import { describe, expect, it } from "vitest";
import { ADMINISTRATIVE_PERMISSIONS, PERMISSIONS, permissionsForRoles, ROLE_PERMISSIONS } from "@/modules/identity/permissions";
import { STRUCTURAL_AUDIT_FIELDS } from "@/modules/audit/audit";
import {
  documentState,
  HISTORY_EVENT_TYPES,
  isSignedDateAllowed,
  normalizeContractNumber,
  REASON_REQUIRED_EVENTS,
  RELATIONSHIP_TYPES,
} from "@/modules/contracts/model";
import { contractDisposition, isOperationalContract } from "@/modules/contracts/queries";

// Phase 2A slice 2A-1 (ADR-0005): pure contract rules and the approved permission composition (C-106).
describe("Contract Number normalization (M-15, M-18)", () => {
  it("trims surrounding whitespace (including tabs and non-breaking spaces) and keeps case and inner spaces", () => {
    expect(normalizeContractNumber("  HĐLĐ-2026/001 \t")).toBe("HĐLĐ-2026/001");
    expect(normalizeContractNumber(" A 1 ")).toBe("A 1");
    expect(normalizeContractNumber("abc")).toBe("abc");
  });
  it("an empty value after trimming means no number", () => {
    expect(normalizeContractNumber("   ")).toBeNull();
    expect(normalizeContractNumber("")).toBeNull();
    expect(normalizeContractNumber(null)).toBeNull();
    expect(normalizeContractNumber(undefined)).toBeNull();
  });
});

describe("Document state and disposition (ADR-0005 §4, §6)", () => {
  const at = new Date("2026-10-15T03:00:00Z");
  it("is derived from the markers: Draft → Finalized → Signed", () => {
    expect(documentState({ finalizedAt: null, signedAt: null })).toBe("draft");
    expect(documentState({ finalizedAt: at, signedAt: null })).toBe("finalized");
    expect(documentState({ finalizedAt: at, signedAt: at })).toBe("signed");
  });
  it("dispositions are separate from the document state; an Ended period is operational, a cancelled/voided one is not", () => {
    const period = { cancelledAt: null, voidedAt: null };
    expect(contractDisposition({ cancelledAt: at, voidedAt: null })).toBe("cancelled");
    expect(contractDisposition({ cancelledAt: null, voidedAt: at })).toBe("voided");
    expect(isOperationalContract({ cancelledAt: null, voidedAt: null, employment: period })).toBe(true);
    expect(isOperationalContract({ cancelledAt: null, voidedAt: null, employment: { cancelledAt: at, voidedAt: null } })).toBe(false);
    expect(isOperationalContract({ cancelledAt: null, voidedAt: null, employment: { cancelledAt: null, voidedAt: at } })).toBe(false);
    expect(isOperationalContract({ cancelledAt: at, voidedAt: null, employment: period })).toBe(false);
  });
});

describe("signed_at business date (C-105, C-109)", () => {
  it("may be today or in the past, never in the future (Asia/Ho_Chi_Minh business date)", () => {
    expect(isSignedDateAllowed("2026-10-15", "2026-10-15")).toBe(true);
    expect(isSignedDateAllowed("2020-01-01", "2026-10-15")).toBe(true);
    expect(isSignedDateAllowed("2026-10-16", "2026-10-15")).toBe(false);
  });
});

describe("Value sets mirrored from the database", () => {
  it("renewal is the only relationship type (amendment gated) and history events match the approved list", () => {
    expect(RELATIONSHIP_TYPES).toEqual(["renewal"]);
    expect(HISTORY_EVENT_TYPES).not.toContain("amendment_created");
    expect(REASON_REQUIRED_EVENTS).toEqual(["returned_to_draft", "cancelled", "corrected", "voided"]);
    expect(STRUCTURAL_AUDIT_FIELDS.filter((f) => f.startsWith("contract."))).toEqual([
      "contract.contract_type_id",
      "contract.contract_number",
      "contract.effective_from",
      "contract.effective_to",
      "contract.is_open_ended",
      "contract.signed_at",
      "contract.finalized_at",
    ]);
  });
});

describe("Contract permission composition (C-106)", () => {
  const contracts = (roles: string[]) => [...permissionsForRoles(roles)].filter((p) => p.startsWith("contracts.")).sort();
  it("defines exactly four stable contract permissions", () => {
    expect(PERMISSIONS.filter((p) => p.startsWith("contracts."))).toEqual(["contracts.read", "contracts.manage", "contracts.finalize", "contracts.correct"]);
  });
  it("HR_ADMIN holds all four; HR_EDITOR may finalize but never correct; API_DOCS_READER holds none", () => {
    expect(contracts(["HR_ADMIN"])).toEqual(["contracts.correct", "contracts.finalize", "contracts.manage", "contracts.read"]);
    expect(contracts(["HR_EDITOR"])).toEqual(["contracts.finalize", "contracts.manage", "contracts.read"]);
    expect(contracts(["API_DOCS_READER"])).toEqual([]);
    expect(contracts([])).toEqual([]);
  });
  it("contract access is never implied by directory or catalog access, and access administration is unchanged", () => {
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
      if (perms.includes("contracts.read")) continue;
      expect(perms.some((p) => p.startsWith("contracts.")), role).toBe(false);
    }
    expect(ADMINISTRATIVE_PERMISSIONS).toEqual(["employment.correct", "catalogs.manage", "employees.set_code"]);
  });
});
