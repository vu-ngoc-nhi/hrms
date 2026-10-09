import { afterEach, describe, expect, it, vi } from "vitest";
import { getConfig, isTestIdentityAllowed, resetConfigForTests } from "@/lib/config";

afterEach(() => {
  vi.unstubAllEnvs();
  resetConfigForTests();
});

describe("Test identity gate", () => {
  it("is enabled only with test mode + flag + APP_ENV local/test + NODE_ENV not production", () => {
    const base = { appEnv: "local", nodeEnv: "development", authMode: "test", testIssuerFlag: "true" };
    expect(isTestIdentityAllowed(base)).toBe(true);
    expect(isTestIdentityAllowed({ ...base, appEnv: "production" })).toBe(false);
    expect(isTestIdentityAllowed({ ...base, nodeEnv: "production" })).toBe(false);
    expect(isTestIdentityAllowed({ ...base, testIssuerFlag: undefined })).toBe(false);
    expect(isTestIdentityAllowed({ ...base, testIssuerFlag: "false" })).toBe(false);
    expect(isTestIdentityAllowed({ ...base, authMode: "entra" })).toBe(false);
  });
  it("defaults APP_ENV to production, so a missing setting never enables the test issuer", () => {
    vi.stubEnv("APP_ENV", undefined as unknown as string);
    resetConfigForTests();
    expect(getConfig().appEnv).toBe("production");
    expect(getConfig().testIssuer).toBeNull();
  });
  it("NODE_ENV=production blocks the test issuer even when APP_ENV=local", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ENV", "local");
    resetConfigForTests();
    expect(getConfig().testIssuer).toBeNull();
  });
});
