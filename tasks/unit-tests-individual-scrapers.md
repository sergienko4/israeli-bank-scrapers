# Task: Unit Tests for Individual Scrapers

## Context

12 individual scraper files at 12-32% coverage with 0% branch/function coverage. Focus on top 6 by ROI — highest coverage gain per effort hour. Test through public API (`scrape()`) by mocking external dependencies.

## Scraper Complexity Matrix

| Scraper | Lines | Stmts | Branches | Complexity | Key challenge |
|---------|-------|-------|----------|------------|---------------|
| hapoalim.ts | 306 | 12% | 0% | HIGH | XSRF token, nested beneficiary memo, 3 API calls |
| leumi.ts | 256 | 17% | 0% | HIGH | Response interception, dynamic login URL, 4-way race |
| discount.ts | 187 | 22% | 0% | MEDIUM | Future txns, error field handling |
| max.ts | 398 | 31% | 8% | HIGH | 20+ plan types switch, installments, multi-month |
| visa-cal.ts | 553 | 16% | 3% | VERY HIGH | Iframe, session storage, auth token, 4-year pagination |
| mizrahi.ts | 420 | 23% | 0% | HIGH | Dual endpoint race, pending iframe, opt-in features |
| one-zero.ts | 348 | 12% | 0% | HIGH | Non-browser, 2FA, GraphQL, Hebrew sanitization |
| behatsdaa.ts | 141 | 29% | 0% | LOW | Simple token + single API call |
| beyahad-bishvilha.ts | 195 | 18% | 0% | MEDIUM | DOM 7-column parsing, 3 currency symbols |
| union-bank.ts | 336 | 17% | 0% | MEDIUM-HIGH | Dual table, header mapping, date picker |
| yahav.ts | 309 | 16% | 0% | MEDIUM | 7-step calendar picker, DOM parsing |
| base-beinleumi-group.ts | 544 | 17% | 0% | HIGH | Dual UI, iframe, dropdown — base for 5 banks |

## Selected 6 scrapers (ordered by ROI)

### 1. discount.ts (~8 tests, 30min)

**What to test:**
- Successful login + fetch accounts + fetch transactions
- Transaction conversion: amount, date, description
- Future (pending) transactions
- Error in transaction response (`txnsResult.Error`)
- Missing accounts response
- Multiple accounts

**Mock responses:** `fetchGetWithinPage` for accounts (`userAccountsData`) + transactions (`lastTransactions`)

### 2. max.ts (~10 tests, 45min)

**What to test:**
- Successful login + transaction fetch
- Transaction type switch: Normal, Installments (from 20+ plan names)
- `getMemo()`: comments, fundsTransfer, combined
- Currency conversion
- Multi-month pagination
- Categories loading
- Empty month response

**Mock responses:** `fetchGetWithinPage` for transactions URL with filterData param

### 3. one-zero.ts (~8 tests, 45min)

**What to test:**
- Login with long-term OTP token
- Login with OTP callback (trigger + verify)
- Fetch portfolios via GraphQL
- Transaction conversion with Hebrew sanitization
- Pagination (hasNextPage loop)
- Empty portfolio response
- Error in GraphQL response

**Note:** Extends `BaseScraper` (NOT browser-based). Mock `fetchPost` + `fetchGraphql` directly.

### 4. base-beinleumi-group.ts (~8 tests, 45min)

**What to test:**
- Successful login + account fetch
- Multi-account dropdown selection
- Transaction page extraction
- Dual UI detection (iframe vs direct)
- Pagination across multiple pages
- Account number extraction

**Note:** Base class for 5 banks (beinleumi, pagi, mercantile, otsar-hahayal, massad).

### 5. hapoalim.ts (~6 tests, 30min)

**What to test:**
- Successful login + XSRF token extraction + fetch
- Transaction conversion with beneficiary memo fields
- Balance extraction
- Extra transaction details enrichment
- Empty transactions

**Mock responses:** `fetchPostWithinPage` with XSRF headers from cookies

### 6. beyahad-bishvilha.ts (~5 tests, 20min)

**What to test:**
- Successful login + DOM transaction extraction
- Currency parsing: ₪, $, €, unknown
- Amount parsing (debit vs credit)
- Empty transactions table

**Mock responses:** `page.evaluate` / `pageEvalAll` for DOM extraction

## Mocking strategy (same for all)

```typescript
jest.mock('puppeteer')
jest.mock('../helpers/fetch')              // fetchGetWithinPage, fetchPostWithinPage
jest.mock('../helpers/browser')            // applyAntiDetection, isBotDetectionScript
jest.mock('../helpers/waiting')            // sleep, runSerial, TimeoutError
jest.mock('../helpers/debug')              // getDebug
jest.mock('../helpers/elements-interactions') // fillInput, clickButton, waitUntilElementFound
jest.mock('../helpers/navigation')         // getCurrentUrl, waitForNavigation, waitForRedirect
```

## Expected results

| Metric | Before | After |
|--------|--------|-------|
| Global stmts | 43% | ~53% |
| Global branches | 34% | ~42% |
| Global funcs | 27% | ~35% |
| Tests count | 214 | ~259 |

## Files to create/modify

1. `src/scrapers/discount.test.ts` — rewrite (currently only real-API tests)
2. `src/scrapers/max.test.ts` — expand (has `getMemo` unit tests already)
3. `src/scrapers/one-zero.test.ts` — rewrite (currently only real-API tests)
4. `src/scrapers/base-beinleumi-group.test.ts` — new
5. `src/scrapers/hapoalim.test.ts` — rewrite (currently only real-API tests)
6. `src/scrapers/beyahad-bishvilha.test.ts` — rewrite (currently only real-API tests)

## Deferred scrapers

| Scraper | Why |
|---------|-----|
| visa-cal.ts | VERY HIGH complexity — iframe + session storage + auth interception |
| leumi.ts | HIGH — response interception + dynamic login URL |
| mizrahi.ts | HIGH — dual endpoint race + request modification |
| union-bank.ts | MEDIUM-HIGH — dual table parsing less critical |
| yahav.ts | MEDIUM — calendar picker, low user base |
| behatsdaa.ts | LOW — simple flow, low coverage gain |

## Acceptance criteria

- [x] All existing tests still pass (284 passed, 24 skipped)
- [x] 79 new tests across 6 files
- [x] ESLint, TypeScript, Prettier clean
- [x] Coverage thresholds ratcheted (stmts 42→64, branches 30→56, funcs 25→49, lines 42→65)
- [ ] Real E2E tests still pass locally
