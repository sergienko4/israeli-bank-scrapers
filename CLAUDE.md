# Claude Code Instructions — israeli-bank-scrapers (Fork)

## Project

Fork of [eshaham/israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers) with Camoufox/Playwright WAF bypass.

Published as `@sergienko4/israeli-bank-scrapers` on npm.

## Code Quality

> **Canonical caps:** see [CLEAN_CODE.md](./CLEAN_CODE.md) for the single source
> of truth on per-function, file-size, complexity, and parameter limits.
> The pre-commit `lint:guideline-coverage` gate asserts `eslint.config.mjs`
> actually enforces those caps for every Pipeline cluster.

- SOLID principles, especially OCP (maps over if/else)
- **≤ 10 lines per function** (hard cap — see [CLEAN_CODE.md §1
  "Function too long"](./CLEAN_CODE.md#1-function-too-long-max-lines-per-function)
  for the per-cluster table + how to refactor)
- TypeScript strict mode — no `any`, no unused vars
- Follow existing style: Prettier (100 width, single quotes, trailing commas) + ESLint 10 flat config
- Generic over duplication — use factories, shared helpers, config arrays
- Constants from configuration — never hardcode values inline

## Architecture Rules — ABSOLUTE

### ZERO CSS Selectors in Interaction Code
- **NO** `$eval`, `$$eval`, `page.$()`, `querySelector`, `waitForSelector('#id')` in click/fill/navigate/wait code
- **NO** hardcoded CSS IDs, classes, or attribute selectors in user-facing interaction flows
- **ONLY** visible text the user can read: `getByText()`, `getByRole()`, `getByPlaceholder()`
- Text IS the stable anchor — once found, extract all metadata dynamically
- Use `WELL_KNOWN_LOGIN_SELECTORS` / `WELL_KNOWN_DASHBOARD_SELECTORS` from `WellKnownSelectors.ts`
- Priority: visible text → semantic HTML → textContent walk-up (down to up)
- **Exceptions:** Structural CSS selectors are allowed in parsing/extraction code (e.g., `pageEvalAll` table parsing, date picker grid navigation, frame detection via `input[type="password"]`)

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
- Save ALL output to temp log files (`/tmp/*.log` on Unix, `%TEMP%\*.log` on Windows), read ALL logs, resolve ALL issues in one pass
- Self-review before committing: check big picture, factories, DRY, config usage

### Pre-Commit Protocol
- Run targeted tests first (`npx jest --testPathPatterns=...`) to validate
- Only attempt full commit when targeted tests pass
- If commit hook gate 7 (real E2E) fails: READ THE LOG, investigate, don't retry blindly

### Pre-Push / PR Protocol
- Write the PR body to `.git/PR_BODY.md` (gitignored) **before** running `gh pr create`
- Validate locally with `npm run lint:pr-body -- --file .git/PR_BODY.md`
  (mirrors the CI `Validate PR body sections` gate — checks for `## Why`,
  `## What`, `## Guideline compliance` per `pr-guidlines.md` §7 + §10)
- The `.husky/pre-push` hook auto-runs the same validation when it finds
  `PR_BODY_FILE`, `.git/PR_BODY.md`, or `.github/PR_BODY.md`
- Open the PR with `gh pr create --body-file .git/PR_BODY.md`
- See [docs/workflow/pre-push.md](./docs/workflow/pre-push.md) for the full workflow

## Workflow

1. Branch from `main`: `git checkout -b fix/description`
2. Build: `npm run build` (Babel + TSC)
3. Test: `npm test` (Jest)
4. Lint: `npm run lint`
5. Conventional commits: `fix:`, `feat:`, `refactor:`
6. PR → squash merge to main
7. release-please creates Release PR → merge to publish

## Key Files

> Paths here are verified by `npm run lint:doc-paths`. If you move a file,
> that gate fails until this list is updated — see
> [docs/workflow/doc-paths.md](./docs/workflow/doc-paths.md).

- `src/Common/Browser.ts` — `buildContextOptions()`: Israel locale + timezone, `viewport: null` so the render surface follows the Camoufox launch window
- `src/Scrapers/Base/Errors.ts` — `WafBlockError` with structured `IWafErrorDetails` (provider, httpStatus, pageTitle, pageUrl, suggestions)
- `src/Scrapers/Pipeline/Mediator/Browser/CamoufoxLauncher.ts` — `launchCamoufox()`; re-exported by `src/Common/CamoufoxLauncher.ts`
- `src/Scrapers/Pipeline/Mediator/Network/Fetch/PageFetchPost.ts` — `fetchPostWithinPage()` with HTTP status capture; re-exported by `src/Common/Fetch.ts`
- `src/Scrapers/Pipeline/Mediator/Network/Fetch/WafDetection.ts` — `detectWafBlock()`: classifies a response as a WAF block
- `src/Scrapers/Pipeline/Mediator/Timing/TimingActions.ts` — `humanDelay(min, max)`, the source of every human-like pause
- `src/Scrapers/Pipeline/Mediator/Elements/ElementsInteractionConfig.ts` — delay ranges (fill-input 200–600 ms)
- `src/Scrapers/Pipeline/Mediator/Elements/ElementsInteractions.ts` — fill, click, capture, presence check
- `src/Scrapers/Base/BaseScraperWithBrowser.ts` — base class; `launchCamoufox()` → `newContext()` → `newPage()`
- `src/Scrapers/Base/Interface.ts` — type definitions (`ScraperOptions`, `ScraperCredentials`, etc.)
- `src/Scrapers/Registry/ScraperRegistryAmexToIsracard.ts` — Amex→Isracard scraper registry entries

## Changes from upstream

- Browser engine: Camoufox (Firefox anti-detect) driven through Playwright, replacing Puppeteer — clears Cloudflare without a stealth plugin
- `src/Common/Browser.ts`: `buildContextOptions()` sets locale, timezone and `viewport: null`; it deliberately sets no `userAgent`, leaving Camoufox's own fingerprint intact
- `src/Scrapers/Base/BaseScraperWithBrowser.ts`: `launchCamoufox()` → `browser.newContext()` → `context.newPage()`
- `src/Scrapers/Pipeline/Mediator/Timing/TimingActions.ts`: `humanDelay()` behind form interactions (fill-input 200–600 ms)
- `src/Scrapers/Base/Errors.ts`: `WafBlockError` carrying `IWafErrorDetails`
- CI/CD: release-please + npm publish pipeline, Camoufox browser install in CI
