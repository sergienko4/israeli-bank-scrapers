# Task: Add Comprehensive E2E Tests

## Current State

Basic E2E test exists at `src/tests/e2e.test.ts` covering:

- Factory instantiation for all company types
- SCRAPERS definition completeness
- Graceful error handling with invalid browser path

## Target

Full end-to-end coverage of the scraper lifecycle without hitting real bank APIs.

## Planned E2E Tests

### 1. Browser Anti-Detection Verification

Test that `applyAntiDetection()` correctly configures a real browser:

- navigator.webdriver is hidden
- User agent matches expected pattern
- Client hints are set
- Known bot detection scripts are blocked

### 2. Scraper Lifecycle Tests

For each scraper type, mock the bank's web pages and verify:

- Login page detection and form filling
- Navigation through multi-step flows
- Transaction data extraction from mock HTML
- Proper cleanup (browser close) on success and failure

### 3. Error Scenario Tests

- Network timeout handling
- Invalid login detection
- Two-factor authentication flow
- Bank maintenance page detection
- Session expiry during scraping

### 4. Integration with External Browser

Test `ExternalBrowserOptions` and `ExternalBrowserContextOptions`:

- Connect to existing browser instance
- Use existing browser context
- Verify no browser launch when external provided

## Implementation Approach

Use puppeteer's built-in `page.setContent()` or `page.route()` to serve
mock HTML that mimics bank login pages. This avoids network requests while
testing the full scraper flow from login to transaction extraction.

## Test Location

`src/tests/e2e.test.ts` — extend the existing file or split into:

- `src/tests/e2e-factory.test.ts`
- `src/tests/e2e-browser.test.ts`
- `src/tests/e2e-scrapers.test.ts`
