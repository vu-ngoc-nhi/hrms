import { describe, expect, it } from "vitest";
import { warningFingerprint, warningFingerprintFacts, type Finding } from "@/modules/contracts/evaluation";

// M-19 warning fingerprint, version 2 (C-120): a Finalize confirmation binds to the authoritative facts HR reviewed,
// not just to "some warning of this code about that contract". Executed against the real function.
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const overlap = (o: Partial<Finding> = {}): Finding => ({
  code: "OVERLAPPING_CONTRACT",
  message: "Overlaps another contract of this person.",
  related_contract_id: A,
  related_contract_number: "ACC-B-001",
  affected_from: "2027-06-01",
  affected_to: "2027-10-31",
  ...o,
});
const gap = (o: Partial<Finding> = {}): Finding => ({
  code: "GAP_AFTER_PREDECESSOR",
  message: "There is a gap after the previous contract.",
  related_contract_id: B,
  related_contract_number: "ACC-R-B-001",
  affected_from: "2027-11-06",
  affected_to: "2027-11-30",
  ...o,
});
const endsAfter = (o: Partial<Finding> = {}): Finding => ({
  code: "CONTRACT_ENDS_AFTER_EMPLOYMENT_PERIOD",
  message: "Effective To is after the end of the employment period.",
  field: "effective_to",
  affected_from: "2027-01-01",
  affected_to: "2027-06-30",
  ...o,
});
const fp = (...ws: Finding[]) => warningFingerprint(ws);

describe("M-19 fingerprint (w2)", () => {
  it("identical facts → the same fingerprint; no warnings → none", () => {
    expect(fp(overlap(), gap())).toBe(fp(overlap(), gap()));
    expect(fp(overlap())).toMatch(/^w2:[0-9a-f]{64}$/);
    expect(warningFingerprint([])).toBeNull();
  });

  it("reordering the warnings → the same fingerprint", () => {
    expect(fp(gap(), endsAfter(), overlap())).toBe(fp(overlap(), gap(), endsAfter()));
  });

  it("a different related contract → a different fingerprint", () => {
    expect(fp(overlap({ related_contract_id: B }))).not.toBe(fp(overlap()));
  });

  it("changed overlap dates → a different fingerprint (the v1 defect)", () => {
    expect(fp(overlap({ affected_from: "2027-07-01" }))).not.toBe(fp(overlap()));
    expect(fp(overlap({ affected_to: "2027-09-30" }))).not.toBe(fp(overlap()));
    expect(fp(overlap({ affected_to: null }))).not.toBe(fp(overlap())); // no end yet vs a dated end
  });

  it("changed gap / ends-after-period ranges → a different fingerprint", () => {
    expect(fp(gap({ affected_from: "2027-11-16" }))).not.toBe(fp(gap()));
    expect(fp(gap({ affected_to: "2027-12-14" }))).not.toBe(fp(gap()));
    expect(fp(endsAfter({ affected_from: "2026-12-01" }))).not.toBe(fp(endsAfter()));
  });

  it("a warning appearing or disappearing → a different fingerprint", () => {
    expect(fp(overlap(), gap())).not.toBe(fp(overlap()));
  });

  it("display-only changes (message, translation, formatting, contract number) → the same fingerprint", () => {
    expect(fp(overlap({ message: "Chồng lấn với hợp đồng khác." }))).toBe(fp(overlap()));
    expect(fp(overlap({ related_contract_number: "RENUMBERED-9" }))).toBe(fp(overlap()));
    expect(fp(overlap({ related_contract_number: null }))).toBe(fp(overlap()));
  });

  it("the canonical facts are structured (no delimiter ambiguity) and exclude presentation", () => {
    expect(warningFingerprintFacts(overlap())).toEqual({ code: "OVERLAPPING_CONTRACT", related_contract_id: A, field: null, affected_from: "2027-06-01", affected_to: "2027-10-31" });
    // Values that would collide under "code|id" concatenation stay distinct.
    const tricky1: Finding = { code: "X|Y", message: "", related_contract_id: undefined };
    const tricky2: Finding = { code: "X", message: "", field: "Y" };
    expect(fp(tricky1)).not.toBe(fp(tricky2));
  });
});
