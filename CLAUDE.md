# Claude Code Instructions — israeli-bank-scrapers (Fork)

## Project

Fork of [eshaham/israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers) with WAF bypass via Playwright.

Published as `@sergienko4/israeli-bank-scrapers` on npm.

## Code Quality

- SOLID principles, especially OCP (maps over if/else)
- Max 10 lines per method — extract helpers
- TypeScript strict mode — no `any`, no unused vars
- Follow existing style: Prettier (120 width, single quotes, trailing commas) + ESLint 9 flat config
- Generic over duplication — use factories, shared helpers, config arrays
- Constants from configuration — never hardcode values inline

## Architecture Rules — ABSOLUTE

### ZERO CSS Selectors
- **NO** `$eval`, `$$eval`, `page.$()`, `querySelector`, `waitForSelector('#id')`
- **NO** hardcoded CSS IDs, classes, or attribute selectors anywhere
- **ONLY** visible text the user can read: `getByText()`, `getByRole()`
- Text IS the stable anchor — once found, extract all metadata dynamically
- Use `WELL_KNOWN_LOGIN_SELECTORS` / `WELL_KNOWN_DASHBOARD_SELECTORS` from `WellKnownSelectors.ts`
- Priority: visible text → semantic HTML → textContent walk-up (down to up)

### Middleware Flow
- Find element by visible text (what user sees)
- Collect metadata from DOM element (tag, id, class, parent, attributes)
- Build selectors dynamically from metadata
- SelectorResolver + LoginConfig already implement this — REUSE them

### Factories and Generics
- Use factory functions for test mocks (`makeMockLocator`, `createErrorLocator`)
- Use config arrays (`WRONG_DETAILS_TEXTS`) mapped with `.map()` — no duplication
- Tests must NOT duplicate production logic — import shared helpers
- Use `as const` for literal type narrowing

## Claude Workflow Rules — STRICT

### No Back-and-Forth
- **NEVER** retry commits blindly — validate first, commit once
- **NEVER** blame "rate limiting" or "flaky tests" — read the actual error log
- **NEVER** dismiss test failures without investigating
- **NEVER** move/rename `.env` — the user's environment is sacred
- **NEVER** use `taskkill` on user's processes
- Save ALL output to `/tmp/*.log` files, read ALL logs, fix ALL issues in one pass
- Self-review before committing: check big picture, factories, DRY, config usage

### Pre-Commit Protocol
- Run targeted tests first (`npx jest --testPathPatterns=...`) to validate
- Only attempt full commit when targeted tests pass
- If commit hook gate 7 (real E2E) fails: READ THE LOG, investigate, don't retry blindly

## Workflow

1. Branch from `main`: `git checkout -b fix/description`
2. Build: `npm run build` (Babel + TSC)
3. Test: `npm test` (Jest)
4. Lint: `npm run lint`
5. Conventional commits: `fix:`, `feat:`, `refactor:`
6. PR → squash merge to main
7. release-please creates Release PR → merge to publish

## Key Files

- `src/helpers/browser.ts` — `buildContextOptions()`: Hebrew UA/locale, Israel timezone, client hints for Playwright context
- `src/helpers/elements-interactions.ts` — human-like delays on fillInput/clickButton
- `src/helpers/fetch.ts` — HTTP status capture, WAF block detection in fetchPostWithinPage
- `src/scrapers/base-isracard-amex.ts` — shared Amex/Isracard scraper with human delay before API calls
- `src/scrapers/base-scraper-with-browser.ts` — base class, Playwright browser engine (`chromium.launch` → `newContext` → `newPage`)
- `src/scrapers/errors.ts` — WafBlockError class with structured WafErrorDetails (provider, suggestions)
- `src/scrapers/interface.ts` — type definitions (ScraperOptions, ScraperCredentials, etc.)

## Changes from upstream

- Browser engine: Playwright instead of Puppeteer — bypasses Cloudflare WAF natively, no stealth needed
- `src/helpers/browser.ts`: `buildContextOptions()` with Hebrew UA, locale, timezone, client hints (no stealth overrides)
- `src/scrapers/base-scraper-with-browser.ts`: `chromium.launch()` → `browser.newContext()` → `context.newPage()`
- `src/helpers/elements-interactions.ts`: Human-like delays (300-1200ms) on form interactions
- `src/scrapers/base-isracard-amex.ts`: Human delay before API calls
- `src/scrapers/errors.ts`: WafBlockError with WafErrorDetails (provider, httpStatus, pageTitle, suggestions)
- CI/CD: release-please + npm publish pipeline, Playwright browser install in CI
