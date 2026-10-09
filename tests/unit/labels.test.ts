import { describe, expect, it } from "vitest";
import { t } from "@/i18n";

describe("Employment status display labels (C-16)", () => {
  it("maps stable codes to Pre-start / Active / Ended", () => {
    expect(t("employmentStatus.not_started")).toBe("Pre-start");
    expect(t("employmentStatus.active")).toBe("Active");
    expect(t("employmentStatus.ended")).toBe("Ended");
  });
});
