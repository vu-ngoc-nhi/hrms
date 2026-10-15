# Eme People — HTTP Security Headers and Startup Check

- Date: 2026-10-12. Gate A2 local hardening L1 (headers) and L2 (startup check). Proven locally only; staging verification is part of the coordinated staging rehearsal (`gate-a-readiness-status.md`).

## 1. Applied now (L1, `next.config.ts`)

Every page and API response (`/:path*`); `X-Powered-By` removed (`poweredByHeader: false`).

| Header | Value | Why |
|---|---|---|
| `Strict-Transport-Security` | `max-age=31536000` | HTTPS only for a year once seen over HTTPS (browsers ignore it over HTTP, so local development is unaffected) |
| `Content-Security-Policy` | `frame-ancestors 'self'; base-uri 'self'; object-src 'none'` | No framing by other origins (clickjacking), no `<base>` hijack, no plugins. Contains no script/style/connect restriction |
| `X-Frame-Options` | `SAMEORIGIN` | Same protection for older browsers |
| `X-Content-Type-Options` | `nosniff` | No MIME sniffing |
| `Referrer-Policy` | `same-origin` | Search URLs can contain names; nothing is sent to other origins (including Entra) |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` | Features Eme People never uses |

Same-origin framing (`'self'` / `SAMEORIGIN`) rather than `DENY` is deliberate: MSAL's silent token renewal can load the app's own redirect page in a hidden iframe.

Verified 2026-10-12: unit test `tests/unit/security-headers.test.ts`; `next build` + `next start` with a synthetic production configuration returned all six headers on `/login` and `/api/v1/me`, no `X-Powered-By`, `/api/v1/dev/test-users` → 404; the local UI (Home, API docs page) renders with no CSP violation.

## 2. Deferred until Entra browser sign-in can be tested (A3)

| Item | Reason for waiting | When |
|---|---|---|
| `default-src`, `script-src`, `style-src`, `connect-src`, `img-src`, `font-src` | Must allow the Entra endpoints (`login.microsoftonline.com`) and Next.js scripts; a wrong policy blocks sign-in. Needs nonces or hashes for Next.js inline scripts | After MSAL integration, validated with real non-prod tokens |
| `frame-src` | MSAL silent renewal frames | Same |
| `form-action` | Must not interfere with the Entra redirect / logout flow | Same |
| `Cross-Origin-Opener-Policy` | `same-origin` breaks MSAL popup flows | Decide with the chosen MSAL interaction type |
| HSTS `includeSubDomains` / `preload` | Depends on the production hostname and other services under the domain | After IT-04 (DNS/TLS) |
| `Cache-Control` for pages | Unchanged (APIs that need it already send `no-store`) | Gate C unless a finding appears |

The CSP final policy is a Gate A2 closure item once A3 sign-in exists; the reverse proxy must not add CORS headers or duplicate/override these headers (IT-06).

## 3. Startup check (L2, `src/instrumentation.ts` → `unsafeRuntimeConfig` in `src/lib/config.ts`)

On `next start` the process exits with code 1 before serving any request, logging one JSON line with the offending variable **names** (never values), when:

- `APP_ENV` is not `local`, `test` or `production`, or is not `production` while `NODE_ENV=production`;
- under `APP_ENV=production`: `NODE_ENV` ≠ `production`; `AUTH_MODE` ≠ `entra`; `ENTRA_TENANT_ID` missing / not a GUID / the development test tenant; `ENTRA_API_CLIENT_ID` missing or not a GUID; `ENTRA_API_SCOPE` not a bare scope name; `IDEMPOTENCY_HMAC_KEY` < 32 characters or a development value; `COMPANY_EMAIL_DOMAINS` empty, malformed or reserved (`.test`, `.example`, `.invalid`, `.localhost`, `.local`, `example.com|net|org`); `DATABASE_URL` not PostgreSQL, using the public development password, or `hrms_dev` / `hrms_test`; `MIGRATION_DATABASE_URL`, `TEST_DATABASE_URL`, `TEST_MIGRATION_DATABASE_URL`, `ACCESS_ADMIN_DATABASE_URL`, `AUTH_TEST_ISSUER_ENABLED` or `AUTH_TEST_ISSUER_SECRET` present.

`next build` and `npm run dev` are not affected. Request-time behaviour is unchanged (a missing Entra value still fails closed with 401). Deferred: the `NEXT_PUBLIC_ENTRA_*` browser values, checked once MSAL exists.
