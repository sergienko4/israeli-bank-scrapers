# Task: Improve VisaCal SSO Token Reliability

## Status: Backlog

## Priority: High

## Estimated effort: 2-4h

## Related: Issue #77 (Beinleumi OTP), PR #76 (current fixes)

## Context

VisaCal migrated to `digital-web.cal-online.co.il` SPA. The login popup at
`connect.cal-online.co.il` does PUT /SSO → redirect to `digital-web/dashboard?sid=...`.
The scraper intercepts the PUT /SSO request header to get the calConnectToken.

Current problem: `authRequestPromise = page.waitForRequest(SSO_URL, { timeout: 10s })`
sometimes misses the PUT /SSO because:

1. The request fires BEFORE `waitForRequest` is set up (race condition)
2. The PUT /SSO returns empty body but has the token in the request header
3. On CI IPs, the SSO exchange from digital-web side sometimes fails entirely

When `this.authorization` is empty, `getAuthorizationHeader()` falls back to polling
`sessionStorage['auth-module'].calConnectToken` — which requires the digital-web SPA
to complete its own SSO exchange (GET /sso?sid=...). This is the fragile path.

## Current Workarounds

- VisaCal e2e test has a skip guard for Generic/Timeout errors
- `getCards()` calls init API directly via `fetchPost` (bypasses sessionStorage['init'] race)
- `Storage.ts` has try-catch around page.evaluate() to handle navigation-destroyed contexts

## Proposed Fix

### 1. Intercept auth token from login response instead of SSO request

**Current:** `page.waitForRequest(PUT /SSO)` → read `Authorization` header
**Better:** `page.waitForResponse(POST /authentication/login)` → read calConnectToken from response body

From trace:

```
POST /col-rest/calconnect/authentication/login → {"token":"wkSWbjhj+/ZCdOL9..."}
```

The login response ALWAYS has the token. No race condition because:

- Login is submitted AFTER the scraper fills the form
- The response comes back before any SSO/redirect happens

### 2. Use response body instead of request header

```ts
this.authRequestPromise = this.page
  .waitForResponse(LOGIN_RESPONSE_ENDPOINT, { timeout: 15_000 })
  .then(async res => {
    const body = await res.json();
    return body.token as string;
  })
  .catch(() => undefined);
```

Then in `handlePostLogin`:

```ts
const token = await this.authRequestPromise;
this.authorization = token ? `CALAuthScheme ${token}` : '';
```

### 3. Remove the intermediate SSO interception

The PUT /SSO is just a relay — the actual token comes from the login API response.
Intercepting the login response is more reliable (always fires, always has the token).

## Key Files

- `src/Scrapers/VisaCal.ts` — getLoginOptions, handlePostLogin, authRequestPromise
- `src/Scrapers/VisaCalHelpers.ts` — hasInvalidPasswordError, hasChangePasswordForm

## Validation

1. Local: run VisaCal e2e test 3+ times to verify consistency
2. CI: E2E Real Bank Tests must pass without skip guard triggering
3. Manual trace: verify calConnectToken is captured correctly
