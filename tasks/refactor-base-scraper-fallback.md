# Task: Strengthen Base Scraper Fallback Mechanism

## Status: Backlog

## Priority: Medium

## Estimated effort: 4-6h

## Context

The 4-round selector resolution (SelectorResolver.ts) works well, but common patterns
are scattered across GenericBankScraper and BaseScraperWithBrowser. Moving shared logic
to the base class will reduce per-bank boilerplate, improve observability, and make the
fallback mechanism available to ALL scrapers (not just GenericBankScraper subclasses).

## Current Architecture

### 4-Round Selector Resolution (SelectorResolver.ts)

1. **Round 1** — Bank-configured CSS selectors (FieldConfig.selectors[0], [1], ...)
2. **Round 2** — Bank-configured display-name fallbacks (placeholder, aria-label)
3. **Round 3** — Global WELL_KNOWN_SELECTORS (Hebrew dictionary: שם משתמש, סיסמה, etc.)
4. **Round 4** — Child iframe search (page.frames() iteration)

### Problems

- `activeLoginContext` tracking duplicated in GenericBankScraper (L136-148) AND BaseScraperWithBrowser (L133-149)
- Submit button resolution has separate special logic in GenericBankScraper (L115-126)
- No DEBUG logging of which round succeeded per field (only in SelectorResolver internals)
- postAction hooks repeat "wait for redirect" patterns across BankRegistryExtra (~250 lines)
- Error messages don't include bank-specific suggestions

## Subtasks

### 1. Extract `resolveFieldWithContextTracking()` to BaseScraperWithBrowser

**Files:** BaseScraperWithBrowser.ts, GenericBankScraper.ts
**What:** Move iframe-tracking logic to a single protected method in the base class.
Both GenericBankScraper.resolveAndFill() and BaseScraperWithBrowser.fillOneInput() delegate to it.
**Test:** Existing selector fallback tests (mocked + real) validate behavior unchanged.

### 2. Add DEBUG logging per field in GenericBankScraper

**Files:** GenericBankScraper.ts
**What:** After each resolveFieldContext() call, log which selector/context was used:
`DEBUG('field "%s": resolved to selector "%s" on %s', key, selector, isMainPage ? 'main' : 'iframe')`
**Test:** Run with `DEBUG=generic-bank-scraper` to see trace in e2e tests.

### 3. Extract `resolveAndClickSubmit()` to BaseScraperWithBrowser

**Files:** BaseScraperWithBrowser.ts, GenericBankScraper.ts
**What:** Move submit button resolution from GenericBankScraper.buildSubmitSelector() to
a protected base method. GenericBankScraper becomes a thin wrapper.
**Test:** All login tests (unit + mocked e2e + real e2e) still pass.

### 4. Add `waitUntilLoginComplete()` helper

**Files:** Helpers/Navigation.ts or BaseScraperWithBrowser.ts
**What:** Create a helper that races all possibleResults conditions instead of
requiring per-bank postAction hooks to call waitForNavigation/waitForUrl/sleep.
Replace the default `else { await waitForNavigation(this.page) }` in checkOtpAndNavigate
with `await waitUntilLoginComplete(this.page, possibleResults, { timeout })`.
**Test:** Banks without explicit postAction should auto-detect login completion.

### 5. Rich error reporting with FieldResolutionError

**Files:** Helpers/SelectorResolver.ts, Scrapers/Errors.ts
**What:** Create a custom error type that includes:

- Which field failed
- How many candidates were tried per round
- Which page URL was searched
- Suggestions (e.g., "run inspect-bank-login.ts")
  **Test:** Error message format validated in unit tests.

## Dependencies

- Subtask 1 before 3 (submit resolution builds on field resolution)
- Subtask 2 can be done independently
- Subtask 4 can be done independently
- Subtask 5 can be done independently

## Key Files

- `src/Helpers/SelectorResolver.ts` — 4-round resolution, WELL_KNOWN_SELECTORS
- `src/Scrapers/GenericBankScraper.ts` — fillInputs, resolveAndFill, buildSubmitSelector
- `src/Scrapers/BaseScraperWithBrowser.ts` — fillOneInput, checkOtpAndNavigate, activeLoginContext
- `src/Scrapers/LoginConfig.ts` — FieldConfig, SelectorCandidate, LoginConfig types
- `src/Scrapers/BankRegistry.ts` + `BankRegistryExtra.ts` — per-bank configs
- `src/Tests/E2eMocked/SelectorFallback.e2e-mocked.test.ts` — mocked round tests
- `src/Tests/E2eReal/SelectorFallback*.e2e-real.test.ts` — real round tests

## Validation

1. `npm run lint` — 0 errors
2. `npm run test:unit` — 503+ tests pass
3. `npm run test:e2e:mock` — all SelectorFallback tests pass
4. Real e2e: all 5 non-OTP banks pass (Amex, Isracard, Max, Discount, VisaCal)
