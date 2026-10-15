# ADR-0003 — Entra authentication, development test identity and authorization

- Status: **MVP Decision** (M-03). Entra direction: **Confirmed Decision** (C-04). Registration values: **Pending IT configuration** (PV-11).

## Authentication
- The API accepts only `Authorization: Bearer <access token issued for the HRMS API registration>`.
- Configuration comes only from the environment:
  - `ENTRA_TENANT_ID`;
  - `ENTRA_API_CLIENT_ID`;
  - `ENTRA_API_SCOPE` (default `access_as_user`);
  - the SPA registration has separate `NEXT_PUBLIC_ENTRA_*` values. The SPA requests `api://<API client ID>/access_as_user`.
- The API standardizes on **v2 access tokens**. The API registration must set `api.requestedAccessTokenVersion = 2` in the Microsoft Graph-format manifest (null defaults to v1). The older Azure AD Graph manifest called it `accessTokenAcceptedVersion`.
- The Entra verifier checks:
  - RS256 signature against the tenant JWKS;
  - issuer `https://login.microsoftonline.com/{tenant}/v2.0`;
  - `ver` = `2.0` and `aud` = API client ID (in v2 tokens `aud` is always the client ID). The App ID URI is not accepted as an audience;
  - expiry;
  - `tid`;
  - `oid`;
  - `scp` contains `access_as_user`.
- ID tokens, Graph tokens, app-only tokens, `alg: none` and `hrx_` keys are rejected.
- **Real Entra has not been tested**: the logic is tested with locally generated keys only.
- The **development test issuer** (HS256, `https://test-issuer.hrms.invalid`) works only when all of these hold:
  - `AUTH_MODE=test`;
  - `AUTH_TEST_ISSUER_ENABLED=true`;
  - `APP_ENV` is local or test;
  - `NODE_ENV` is not production.

  `APP_ENV` defaults to production. `/api/v1/dev/*` returns 404 otherwise. The browser can only pick a seeded test account; roles always come from the database.
- A valid token without an enabled `app_user` gets 403. Signing in never grants HR access by itself.
- Replacing the test issuer with real sign-in means adding MSAL (Authorization Code + PKCE) in the UI and setting `AUTH_MODE=entra`. The API contract does not change.

## Authorization (least privilege)
Permissions come from `app_user_role` → an allow-list in `src/modules/identity/permissions.ts`. Role codes that are not on the allow-list (including the retired `HR_VIEWER`) grant nothing. A new role only needs an entry there; the database checks only the code format.

| Permission | HR_ADMIN | HR_EDITOR | API_DOCS_READER |
|---|---|---|---|
| employees.read (directory group) | ✓ | ✓ | |
| employees.read_personal / write_personal | ✓ | ✓ | |
| employees.create | ✓ | ✓ | |
| employees.set_code | ✓ | | |
| employees.read_sensitive | — | — | — |
| catalogs.read | ✓ | ✓ | |
| catalogs.manage | ✓ | | |
| contracts.read / contracts.manage / contracts.finalize (Phase 2A, C-106) | ✓ | ✓ | |
| contracts.correct (Phase 2A, C-106) | ✓ | | |
| docs.read | | | ✓ |

- Sensitive groups (legal ID, tax, social insurance, bank, dependants, health, contract, salary) are **rejected by the API** with `422 PROTECTED_FIELD_NOT_ENABLED`.
- Fields outside the caller's permission are omitted from the JSON entirely, not returned as `null`.
- Every 403 is audited with `outcome=denied`, without payload.
