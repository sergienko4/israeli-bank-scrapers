# Task: Add Integration Test Framework for All Scrapers

## Priority: High | Effort: Large (1+ days)

## Current State

The project has a three-tier test pyramid with a significant gap in the middle:

| Layer | Coverage | Details |
|-------|----------|---------|
| Unit tests | 35 files, 86% line coverage | Test individual functions in isolation with mocked dependencies |
| E2E mocked | 2 test files (Amex + anti-detection) | Full scraper flow with real Puppeteer but mocked HTTP |
| E2E real | 3 banks (Amex, VisaCal, Discount) | Real bank APIs, requires credentials, skipped by default |

**The gap:** Only Amex has a mocked integration test. The remaining 12+ scrapers have no full-flow tests without real credentials. This means:
- Login flow + fetchData + transaction parsing aren't tested together
- HTTP error scenarios (WAF blocks, session timeouts, invalid responses) aren't tested
- Regressions in scraper flow require real bank credentials to detect

## Target

A reusable integration test framework that:
1. Tests full scraper flows (login → fetchData → result) with mocked HTTP responses
2. Covers all browser-based scrapers (not just Amex)
3. Supports error scenario testing (failed login, WAF blocks, empty responses)
4. Runs in CI without credentials
5. Is easy to add new scrapers — just provide fixture files + route config

---

## Approach Comparison

### Approach A: Real Browser + Request Interception (extend existing e2e-mocked pattern)

Uses real Puppeteer browser with `page.setRequestInterception()` to serve fixture responses. This is the pattern already used in `amex.e2e-mocked.test.ts`.

```
Test → createScraper({ browser, preparePage }) → Real Puppeteer → Request Interception → Fixture files
```

| Dimension | Assessment |
|-----------|-----------|
| **Fidelity** | High — real DOM, real navigation, real `page.evaluate()`, real anti-detection hooks |
| **Speed** | Slow — ~5-10s per test, ~60s timeout needed, browser startup ~2-3s (amortized via shared instance) |
| **Fixture effort** | High — need full HTML login pages with correct selectors + JSON API responses |
| **Maintenance** | Medium — fixtures break when banks change HTML selectors or API shapes |
| **CI cost** | Medium — needs Puppeteer/Chromium binary in CI (already available) |
| **What it catches** | Navigation bugs, selector mismatches, anti-detection regressions, real DOM parsing issues |
| **Existing infra** | Complete — `browser-fixture.ts`, `request-interceptor.ts`, `amex/` fixtures all exist |
| **Coverage impact** | Low — `page.evaluate()` callbacks run in browser context, not instrumented by Istanbul/Jest |

### Approach B: Jest Module Mocking (extend existing unit test pattern to full flows)

Uses `jest.mock('puppeteer')` + `createMockPage()` + `jest.mock('../helpers/fetch')` to test full scraper flows without any browser. This is the pattern used in `base-isracard-amex.test.ts`.

```
Test → createScraper() → jest.mock(puppeteer) → createMockPage() → jest.mock(fetch) → Inline mock data
```

| Dimension | Assessment |
|-----------|-----------|
| **Fidelity** | Medium — tests the JS logic path but not real browser behavior; `page.goto()` returns mock, selectors aren't verified |
| **Speed** | Fast — ~100ms per test, no browser process |
| **Fixture effort** | Low — inline JSON objects in test files, no HTML fixtures needed |
| **Maintenance** | Low — mock data follows TypeScript interfaces, compiler catches shape mismatches |
| **CI cost** | None — pure Node.js, no browser binary |
| **What it catches** | Logic regressions, data transformation bugs, error handling paths, API response parsing |
| **Existing infra** | Partial — `mock-page.ts` exists but needs extensions per scraper (login result detection, navigation simulation) |
| **Coverage impact** | High — all code runs in Node.js, fully instrumented by Jest/Istanbul |

### Side-by-side

| | Approach A (Real Browser) | Approach B (Jest Mocks) |
|---|---|---|
| Time per test | ~5-10s | ~100ms |
| Time for 40 tests | ~3-5 min | ~5s |
| HTML fixtures needed | Yes (per bank) | No |
| Tests real selectors | Yes | No |
| Tests anti-detection | Yes | No |
| Increases Jest coverage | No | Yes |
| Runs in `npm test` | Currently excluded | Included by default |
| Effort per scraper | ~2-3 hours (fixtures + routes) | ~1-2 hours (mock chains) |
| Browser dependency | Yes (Puppeteer/Chromium) | No |

### Recommendation: Approach B (Jest Module Mocking)

**Rationale:**
1. **Speed matters** — 40+ new tests at ~5-10s each would add 3-5 minutes to CI. Jest mocks run in seconds.
2. **Coverage boost** — Approach B increases the 86% line coverage that the team tracks. Approach A doesn't (browser context is not instrumented).
3. **Lower fixture effort** — No need to reverse-engineer HTML login pages with exact selectors. Mock data follows TypeScript interfaces.
4. **Runs in `npm test`** — E2E mocked tests are excluded from `npm test` (see `jest.config.js` line 16: `testPathIgnorePatterns: [..., 'e2e-mocked/']`). Approach B tests run by default.
5. **Existing Amex pattern proves it works** — `base-isracard-amex.test.ts` already tests login + fetch + parse with full mocks and catches real bugs.
6. **Real browser testing already covered** — The existing 9 e2e-mocked tests + 3 e2e-real tests cover browser-specific concerns (anti-detection, real DOM). Adding more real-browser tests has diminishing returns.

**What Approach A is better for (keep existing e2e-mocked for these):**
- Anti-detection verification (already covered by 5 tests)
- Validating that HTML selectors match real bank pages (better done with e2e-real tests)
- New scraper smoke tests before going live

---

## Planned Work

### 1. Create integration test utilities

**`src/tests/integration-helpers.ts`** — Shared utilities for full-flow mock tests:
- `setupScraperMocks(fetchResponses)` — Configure `jest.mock` for puppeteer, fetch helpers, browser, waiting, transactions
- `createTestScraper(ScraperClass, options?)` — Instantiate scraper with mocked page and standard options
- `mockLoginFlow(page, loginResult)` — Configure mock page to simulate login success/failure URL detection
- `expectSuccessResult(result, expectedAccounts)` — Common success assertions
- `expectErrorResult(result, errorType, messagePattern?)` — Common error assertions

### 2. Write full-flow tests per scraper

Each scraper gets a `<name>.test.ts` file (or section added to existing test file) with full-flow tests:

**Test cases per scraper (minimum 3):**
- Happy path: login succeeds → fetchData returns transactions → correct output shape
- Invalid credentials: login fails → returns `InvalidPassword` error
- Empty/no transactions: login succeeds → empty response → returns empty account array

**Bank-specific edge cases:**
| Scraper | Edge Cases |
|---------|-----------|
| **Isracard** | WAF block detection, dual currency (Israel + abroad), installment parsing |
| **VisaCal** | Multi-card accounts, pending transactions, SSO auth flow |
| **Leumi** | Account blocked, change password redirect, DOM-based error detection |
| **Discount** | WAF block (known CI issue), gateway API errors |
| **Hapoalim** | REST context extraction, multi-account handling |
| **Mizrahi** | API intercept pattern, dropdown navigation |
| **Beinleumi/Massad** | Table-based extraction, credit/debit parsing |
| **Union Bank** | Table extraction, account number from DOM |
| **Yahav** | Similar to Beinleumi pattern |
| **OneZero** | OTP/2FA flow, token-based auth |
| **Beyahad Bishvilha** | Currency symbol variants (₪/$/) in amounts |
| **Max** | Similar to VisaCal SSO pattern |

### 3. Create mock response factories

Reusable factories for common response shapes:

```typescript
// Example: Isracard/Amex response factory
function createIsracardResponse(overrides?: Partial<IsracardResponse>) {
  return {
    Header: { Status: '1' },
    CardsTransactionsListBean: { ... },
    ...overrides,
  };
}

// Example: Table-based scraper response factory
function createTableHtml(rows: { date: string; description: string; credit: string; debit: string }[]) {
  return rows; // Used as mock return from $$eval
}
```

### 4. Add error scenario mocks

Shared error mock configs:
- `mockWafBlock()` — Simulates WAF/bot detection response
- `mockSessionTimeout()` — Simulates expired session
- `mockServerError()` — Simulates 500 error
- `mockInvalidCredentials(scraperType)` — Per-scraper invalid login response

### 5. Update coverage thresholds

After adding integration tests, coverage should increase. Update `jest.config.js` thresholds:
- Target: branches 78%+, functions 80%+, lines 90%+, statements 88%+

## Implementation Approach

### File structure
```
src/tests/
├── integration-helpers.ts           (NEW — shared mock setup/assertions)
├── mock-page.ts                     (existing — extend if needed)
└── ...

src/scrapers/
├── visa-cal.test.ts                 (NEW or extend existing)
├── leumi.test.ts                    (NEW or extend existing)
├── discount.test.ts                 (NEW or extend existing)
├── hapoalim.test.ts                 (NEW or extend existing)
├── mizrahi.test.ts                  (NEW or extend existing)
├── base-beinleumi-group.test.ts     (extend existing)
├── union-bank.test.ts               (NEW or extend existing)
├── yahav.test.ts                    (NEW or extend existing)
├── one-zero.test.ts                 (NEW or extend existing)
├── beyahad-bishvilha.test.ts        (NEW or extend existing)
└── max.test.ts                      (NEW or extend existing)
```

### Key technical decisions

1. **Extend existing test files** — Add `describe('full scrape flow', ...)` blocks to existing `*.test.ts` files rather than creating separate integration test files. This keeps related tests together and avoids file proliferation.

2. **Mock at module boundaries** — Mock `puppeteer`, `../helpers/fetch`, `../helpers/browser`, `../helpers/waiting`, and `../helpers/transactions` — same pattern as `base-isracard-amex.test.ts`.

3. **Simulate login via URL matching** — The base scraper's `login()` method checks `page.url()` against `possibleResults` patterns. Mock `page.url()` to return a URL that matches `LoginResults.Success` or `LoginResults.InvalidPassword`.

4. **Mock `page.evaluate()`/`$eval()` per call order** — Use `mockResolvedValueOnce()` chains to simulate the sequence of page interactions each scraper performs.

5. **TypeScript-first fixtures** — Define mock data as typed objects (not JSON files), so the compiler catches shape mismatches immediately.

6. **Start with highest-value scrapers** — Isracard (shares base with Amex), VisaCal, Leumi, Discount, then others.

### Test strategy

- Integration tests complement (not replace) existing unit tests
- Focus on flow correctness: does login → fetch → parse → return work end-to-end?
- Error tests focus on graceful degradation: does the scraper return proper error types?
- Avoid testing individual function logic (that's what existing unit tests do)
- Keep the existing e2e-mocked tests for browser-level concerns (anti-detection, real DOM)

## Acceptance Criteria

- [ ] Integration test helper module created with shared mock setup/teardown/assertions
- [ ] Full-flow tests for at least 6 scrapers (Isracard, VisaCal, Leumi, Discount, Hapoalim, Mizrahi)
- [ ] Happy-path test passing for each covered scraper
- [ ] Error scenario tests (invalid login, empty data) for each covered scraper
- [ ] Shared error mock utilities for WAF blocks and common failure modes
- [ ] All tests run as part of `npm test` (included by default)
- [ ] All existing tests still pass
- [ ] Jest coverage thresholds raised (branches 78%+, functions 80%+)
- [ ] ESLint, TypeScript, Prettier clean
