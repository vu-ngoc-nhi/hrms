import { describe, expect, it } from "vitest";
import nextConfig, { securityHeaders } from "../../next.config";

const header = (key: string) => securityHeaders.find((h) => h.key === key)?.value;

describe("Baseline security headers (L1)", () => {
  it("apply to every path and hide the framework banner", async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    expect(await nextConfig.headers!()).toEqual([{ source: "/:path*", headers: securityHeaders }]);
  });

  it("set the agreed baseline", () => {
    expect(header("Strict-Transport-Security")).toBe("max-age=31536000");
    expect(header("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(header("X-Content-Type-Options")).toBe("nosniff");
    expect(header("Referrer-Policy")).toBe("same-origin");
    expect(header("Permissions-Policy")).toContain("camera=()");
  });

  it("keep the CSP to directives that cannot break the future Entra sign-in", () => {
    const csp = header("Content-Security-Policy")!;
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("object-src 'none'");
    for (const deferred of ["default-src", "script-src", "style-src", "connect-src", "frame-src", "form-action"]) {
      expect(csp).not.toContain(deferred);
    }
    expect(securityHeaders.some((h) => h.key === "Cross-Origin-Opener-Policy")).toBe(false);
  });
});
