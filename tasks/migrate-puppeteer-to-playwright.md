# Task: Migrate from Puppeteer to Playwright

## Priority: High | Effort: Large (3-5 days)

## Current State

Using Puppeteer 24 with manual stealth overrides + Cloudflare retry backoff (30s/60s/120s).

**Problems:**
- Puppeteer's CDP fingerprint is detected by Cloudflare Bot Management
- Needs 5 manual stealth overrides (webdriver, plugins, chrome.runtime, permissions, languages)
- Needs retry with exponential backoff (30s → 60s → 120s) — adds up to 3.5 min per scrape
- Oracle Cloud IPs fail all retries — Puppeteer cannot access Amex from Oracle
- `--disable-blink-features=AutomationControlled` Chrome arg required

**Validated on production servers (2026-02-26):**

| | Puppeteer | Playwright Chromium | Playwright Firefox |
|---|---|---|---|
| Local | 200 (with stealth) | **200 (no stealth)** | **200 (no stealth)** |
| Azure (Microsoft) | 403 → 200 (30s retry) | **200 (1st attempt)** | **200 (1st attempt)** |
| Oracle (Oracle Cloud) | 403 (all retries fail) | **200 (1st attempt)** | **200 (1st attempt)** |

## Target

- Switch internal browser engine from Puppeteer to Playwright
- Eliminate all stealth overrides, retry backoff, and Cloudflare challenge handling
- No breaking change for 95% of consumers (those using default mode)
- Breaking change only for `browser`/`browserContext`/`preparePage` external options → v7.0.0
- Remove ~200 lines of anti-detection/retry code

## Planned Work

### 1. Replace Puppeteer with Playwright in base-scraper-with-browser.ts

- `import { chromium } from 'playwright'` instead of `import puppeteer from 'puppeteer'`
- `chromium.launch()` → `browser.newContext({ locale, timezoneId, userAgent })` → `context.newPage()`
- Remove `--disable-blink-features=AutomationControlled` arg injection
- Remove `handleCloudflareChallenge`, `tryChallengeAttempt`, `backoffAndReload`, `isCloudflareTitle`, `tryWaitForChallenge`

### 2. Simplify browser.ts (remove stealth)

- Remove `applyStealthOverrides()` (webdriver, plugins, chrome.runtime, permissions)
- Remove `setRealisticUserAgent()`, `setRealisticHeaders()` (handled by context)
- Keep `applyAntiDetection()` as thin wrapper for bank-specific headers only
- Delete ~50 lines of stealth code

### 3. Adapt evaluate calls to Playwright single-arg syntax

Puppeteer: `page.evaluate((a, b) => {}, a, b)`
Playwright: `page.evaluate(({ a, b }) => {}, { a, b })`

Files: `fetch.ts`, `elements-interactions.ts`, `navigation.ts`, all 11 scraper files.

### 4. Update ScraperOptions types

- Change `Browser`, `Page`, `BrowserContext` imports from `puppeteer` to `playwright`
- Deprecate `browser`/`browserContext` options with `@deprecated` JSDoc
- `preparePage` callback receives Playwright `Page`

### 5. Update dependencies

- Remove `puppeteer` from `package.json`
- Add `playwright` (Chromium-only to minimize size)
- Update CI workflows to install Playwright browsers instead of Chrome

### 6. Update all test mocks (13 files)

- `jest.mock('puppeteer', ...)` → `jest.mock('playwright', ...)`
- Update `createMockPage()` in `mock-page.ts` for Playwright API
- Update E2E browser fixture

## Implementation Approach

**Order of changes:**

1. `package.json` — swap deps
2. `src/scrapers/interface.ts` — update types
3. `src/scrapers/base-scraper-with-browser.ts` — core engine switch
4. `src/helpers/browser.ts` — simplify anti-detection
5. `src/helpers/fetch.ts` — evaluate syntax
6. `src/helpers/elements-interactions.ts` — evaluate syntax
7. `src/helpers/navigation.ts` — adapt waitForNavigation
8. Each scraper file — adapt evaluate calls
9. `src/tests/mock-page.ts` — update mock
10. Each test file — update mocks
11. E2E tests — update fixtures
12. CI workflows — install Playwright

**Test strategy:**
- Run `npm test` after each file group
- Run E2E mocked after core changes
- Run E2E real (local) after all changes
- Validate on Azure + Oracle servers before PR

## Acceptance Criteria

- [ ] `npm run build` compiles with zero errors
- [ ] `npm test` — all tests pass
- [ ] `npm run lint` — clean
- [ ] E2E mocked — 17 tests pass
- [ ] E2E real (local) — Amex, VisaCal, Discount pass
- [ ] Azure server — Amex 200 on first attempt (no retry needed)
- [ ] Oracle server — Amex 200 on first attempt (no retry needed)
- [ ] `israeli-bank-importer` works without changes (default mode)
- [ ] No `puppeteer` in `node_modules` (fully replaced)
- [ ] Stealth overrides removed (no webdriver/plugins/chrome.runtime hacks)
- [ ] Cloudflare retry logic removed (not needed with Playwright)
- [ ] README updated to document Playwright
- [ ] CHANGELOG entry via conventional commit (`feat!:`)
