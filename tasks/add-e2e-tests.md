# Task: Add Comprehensive E2E Tests

## Current State

Basic E2E test exists at `src/tests/e2e.test.ts` covering:

- Factory instantiation for all company types
- SCRAPERS definition completeness
- Graceful error handling with invalid browser path

## Target

Full end-to-end coverage of the scraper lifecycle without hitting real bank APIs.

## Acceptance Criteria

- [x] Anti-detection verification (5 tests in `anti-detection.e2e-mocked.test.ts`)
- [x] Amex full lifecycle + error scenarios (4 tests in `amex.e2e-mocked.test.ts`)
- [x] Isracard lifecycle + error scenarios (3 tests in `isracard.e2e-mocked.test.ts`)
- [x] Error scenarios: HTTP 500, invalid validate (2 tests in `error-scenarios.e2e-mocked.test.ts`)
- [x] External browser: shared browser, browser context, sequential scrapes (3 tests in `external-browser.e2e-mocked.test.ts`)
- [x] Mocked E2E tests included in `npm test` (removed from testPathIgnorePatterns)
- [x] Shared route helper extracted (`helpers/amex-routes.ts`)

## Implementation Approach

Use puppeteer's built-in `page.setContent()` or `page.route()` to serve
mock HTML that mimics bank login pages. This avoids network requests while
testing the full scraper flow from login to transaction extraction.

## Test Location

`src/tests/e2e.test.ts` — extend the existing file or split into:

- `src/tests/e2e-factory.test.ts`
- `src/tests/e2e-browser.test.ts`
- `src/tests/e2e-scrapers.test.ts`
