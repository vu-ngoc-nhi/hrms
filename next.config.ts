import type { NextConfig } from "next";

// Baseline HTTP security headers (Gate A2, L1). Applied to every page and API response.
// Deliberately deferred until Entra browser sign-in (MSAL) can be tested: script/style/connect/frame-src CSP
// directives, form-action, and Cross-Origin-Opener-Policy (all can break the Entra redirect/popup or silent
// token renewal). See docs/production/security-headers.md.
export const securityHeaders = [
  // Browsers honour HSTS only over HTTPS; includeSubDomains/preload wait for the production hostname (IT-04).
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  // Same-origin framing stays possible for MSAL's hidden-iframe silent renewal; every other origin is refused.
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Search URLs can contain names: never send a Referer to another origin.
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
