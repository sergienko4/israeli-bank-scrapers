# Task: Add Structured Response Logging to All Scrapers

## Status: Backlog

## Priority: Medium

## Estimated effort: 2-3h

## Context

When scraping fails, the error messages are often minimal ("GENERIC undefined",
"TIMEOUT get init data in session storage"). The caller gets `success: false` with
an errorType and errorMessage but NO information about what the scraper TRIED,
what URL it was on, what selectors it attempted, or what API calls were made.

This makes debugging production issues very hard — you need to run with
`DEBUG=*` and parse raw logs instead of getting structured information in the
scrape result.

## Proposed Changes

### 1. Add `diagnostics` field to ScraperScrapingResult

```ts
interface ScraperScrapingResult {
  success: boolean;
  errorType?: ScraperErrorTypes;
  errorMessage?: string;
  accounts?: TransactionsAccount[];
  // NEW:
  diagnostics?: {
    loginUrl?: string;
    finalUrl?: string;
    loginDurationMs?: number;
    fetchDurationMs?: number;
    selectorRoundsUsed?: Record<string, number>; // field → round that resolved it
    apiCallsMade?: string[]; // URLs of API calls attempted
    warnings?: string[]; // non-fatal issues encountered
  };
}
```

### 2. Populate diagnostics in BaseScraper.scrape()

Track timing and key events during the scrape lifecycle:

- `loginUrl` — from loginOptions.loginUrl
- `finalUrl` — page.url() after login completes
- `loginDurationMs` — time from login start to login result
- `fetchDurationMs` — time from fetchData start to completion
- `warnings` — collected during the scrape (e.g., "SSO token empty", "sessionStorage miss")

### 3. Add diagnostic context in BaseScraperWithBrowser

- After handleFailedLogin: include page URL + page title in diagnostics
- After successful login: include which possibleResult matched
- After fetchData failure: include last-attempted API URL

### 4. Expose diagnostics in error results

When returning errors (createGenericError, createTimeoutError), attach diagnostics:

```ts
return { success: false, errorType, errorMessage, diagnostics: this.diagnostics };
```

## Key Files

- `src/Scrapers/Interface.ts` — ScraperScrapingResult type
- `src/Scrapers/BaseScraper.ts` — scrape() lifecycle
- `src/Scrapers/BaseScraperWithBrowser.ts` — login flow, handlePostLogin
- `src/Scrapers/Errors.ts` — error creation functions
- `src/Helpers/SelectorResolver.ts` — round tracking

## Validation

1. All existing tests pass (diagnostics is optional field)
2. Run real e2e and verify diagnostics appear in result
3. When scrape fails, diagnostics should show exactly what happened
