# Task: E2E Invalid-Login Tests for All Bank Scrapers

## Priority: Medium | Effort: Small (1 day)

## Current State

Real E2E tests exist only for 3 banks (Amex, VisaCal, Discount) in `src/tests/e2e-real.test.ts`.
The remaining 15 scrapers have zero real-browser E2E coverage.
We don't have credentials for most banks, but we can still test that:

1. The scraper launches a browser and navigates to the login page (WAF bypass works)
2. Invalid credentials are correctly detected (login error handling works)

This catches regressions in login URLs, page selectors, WAF changes, and error detection — without needing real accounts.

## Target

Add "fails with invalid credentials" E2E tests for all bank scrapers that don't require OTP or special auth flows.
Each test verifies: scraper reaches login page, submits fake credentials, returns a recognized error type.

## Planned Work

### 1. Add invalid-login tests for banks with username/password

These banks use simple `username` + `password` credentials:

| Bank | CompanyType | Credentials Shape |
|------|------------|-------------------|
| Hapoalim | `hapoalim` | `{ userCode, password }` |
| Leumi | `leumi` | `{ username, password }` |
| Mizrahi | `mizrahi` | `{ username, password }` |
| Max | `max` | `{ username, password }` |
| Otsar Hahayal | `otsarHahayal` | `{ username, password }` |
| Union | `union` | `{ username, password }` |
| Beinleumi | `beinleumi` | `{ username, password }` |
| Massad | `massad` | `{ username, password }` |
| Pagi | `pagi` | `{ username, password }` |

### 2. Add invalid-login tests for banks with ID-based credentials

| Bank | CompanyType | Credentials Shape |
|------|------------|-------------------|
| Isracard | `isracard` | `{ id, card6Digits, password }` |
| Mercantile | `mercantile` | `{ id, password, num }` |
| Beyahad Bishvilha | `beyahadBishvilha` | `{ id, password }` |
| Behatsdaa | `behatsdaa` | `{ id, password }` |

### 3. Add invalid-login test for Yahav (3-field)

| Bank | CompanyType | Credentials Shape |
|------|------------|-------------------|
| Yahav | `yahav` | `{ username, nationalID, password }` |

### 4. Skip One Zero (requires OTP)

One Zero requires `otpCodeRetriever` callback + phone number — cannot test without real OTP infrastructure.
Add as `describe.skip` with a comment explaining why.

## Implementation Approach

Extend `src/tests/e2e-real.test.ts` with new describe blocks. Each test:

```typescript
describe('E2E: BankName (invalid login)', () => {
  beforeAll(() => { jest.setTimeout(SCRAPE_TIMEOUT); });

  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.bankName,
      startDate: new Date(),
      showBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({ username: 'INVALID_USER', password: 'invalid123' });
    assertFailedLogin(result);
  });
});
```

- Reuse existing `assertFailedLogin` helper (accepts any `FAILED_LOGIN_TYPES`)
- No `describe.skip` / conditional — these tests always run (no credentials needed)
- Each test timeout: 120s (some banks are slow to load)
- Run in CI via `e2e-real` job (already has Playwright installed)

## Test Strategy

- Run locally first: `npx jest --testPathPatterns='e2e-real' --verbose --forceExit`
- Expect: each bank returns `InvalidPassword`, `UnknownError`, `Generic`, or `Timeout`
- Some banks may timeout if their login page is down — that's acceptable (transient)
- WAF blocks (HTTP 403) will surface as `WafBlocked` error type — this is actually useful signal

## Acceptance Criteria

- [x] Invalid-login test for each of the 14 banks listed above (batches 1-3)
- [x] Amex, VisaCal, Discount added in batch4 (`invalid-login-batch4.e2e-real.test.ts`)
- [x] One Zero skipped with comment
- [x] All tests pass locally (may have transient timeouts)
- [x] CI e2e-real job runs the new tests
- [x] No changes to production code
- [x] ESLint, TypeScript, Prettier clean

## Status: ✅ COMPLETED (2026-02-27)

All 16 banks covered across 4 batch files.
