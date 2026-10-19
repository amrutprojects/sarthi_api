# ADR-0003: HttpOnly cookie sessions with CSRF protection; bearer tokens for API clients

- Status: Accepted (supersedes the sessionStorage bearer-token design)
- Date: 2026-10-19
- Applies to: amrut-kalash-api and amrut-kalash-admin

## Context

The admin panel kept the JWT in `sessionStorage` and sent it as a bearer token. Any script running in the page (an XSS bug, a compromised dependency) could read and exfiltrate it. The brief requires HttpOnly, Secure, SameSite cookies for browsers, CSRF protection where cookies are used, and no tokens in web storage.

## Decision

- **Browsers**: `POST /auth/login` sets the access token in an `HttpOnly`, `SameSite=Strict` cookie (`Secure` outside development and test, `Path=/`, optional `Domain`). The token is not in the response body.
- **CSRF**: every state-changing request (anything but GET/HEAD/OPTIONS) authenticated by the cookie must send `X-CSRF-Token`. The value is `HMAC-SHA256(JWT_SECRET, "csrf:" + sessionId)`, returned by login and `GET /auth/me`, kept in memory by the panel. Stateless, and stable across token renewals. SameSite=Strict is a second layer, not the only one.
- **Session lifetime**: tokens are short (15 min). A cookie request past half the token lifetime receives a fresh token with the same session id, until `SESSION_MAX_HOURS` after login. Logout revokes both the token id and the session id, so tokens from earlier renewals are rejected too.
- **API clients** (scripts, integrations, tests): send `X-Auth-Mode: bearer` to login to receive `accessToken` in the body and use `Authorization: Bearer`. Bearer requests need no CSRF token (no ambient credentials).
- Every request still re-loads the user and resolves permissions from the database.

## Deployment notes

- Same site: the panel and API should share a registrable domain (e.g. `admin.example.gov.in` and `api.example.gov.in`) so `SameSite=Strict` cookies are sent. If they are on unrelated domains, set `COOKIE_SAMESITE=none` (requires `Secure`) and keep the CORS allow-list strict.
- `FRONTEND_URL` must list the panel origin(s); CORS sends credentials only to those.

## Consequences

- A script injected into the panel can no longer steal the session; it could still act within the open page, so XSS prevention (React escaping, CSP) remains important.
- The panel must call the API with `credentials: 'include'` and attach `X-CSRF-Token` on writes (done in `services/api-client.ts`).
