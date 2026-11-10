# Claude Code Instructions — israeli-bank-scrapers (Fork)

## Project

Fork of [eshaham/israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers) that scrapes every bank over pure HTTP (no browser at scrape time).

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

### Pure HTTP Pipeline — No DOM or Browser Interaction
- Every registered bank runs the same two phases: `ApiDirectCallPhase` (login) then `ApiDirectScrapePhase` (scrape). Both speak HTTP only.
- The browser phases (INIT → HOME → PRE-LOGIN → LOGIN → OTP → DASHBOARD) and their DOM mediators (selector resolution, form fill, element click) were removed. Do **not** reintroduce interaction code; add or extend an `ApiDirect` config and shape instead.
- Structural CSS selectors remain acceptable only in pure parsing/extraction of response bodies, never in a user-facing flow.

### Phases Stay Thin
- A phase orchestrates `PRE → ACTION → POST → FINAL`; every bank-specific decision lives in a config or shape that the phase receives.
- No `if (bank === ...)` in a phase, the builder, or the executor — register a new bank through `Registry` and its `ApiDirect` config.

### Factories and Generics
- Use factory functions for test mocks (`makeMockContext`) — see `src/Tests/Unit/Pipeline/Infrastructure/MockFactories.ts`
- Use config arrays mapped with `.map()` — no duplication
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
- If an enabled hook gate fails: READ THE LOG, investigate, don't retry blindly
- Run only relevant focused tests locally; normal hooks and CI own broader validation. Do not duplicate heavy suites or rerun main/live-bank baselines.

### Pre-Push / PR Protocol
- Write the PR body to `.git/PR_BODY.md` (gitignored) **before** running `gh pr create`
- Validate locally with `npm run lint:pr-body -- --file .git/PR_BODY.md`
  (mirrors the CI `Validate PR body sections` gate — checks for `## Why`,
  `## What`, `## Guideline compliance` per `pr-guidlines.md` §7 + §10)
- The `.husky/pre-push` hook auto-runs the same validation when it finds
  `PR_BODY_FILE`, `.git/PR_BODY.md`, or `.github/PR_BODY.md`
- Open the PR with `gh pr create --body-file .git/PR_BODY.md`
- Claiming "public API unchanged" means `npm run build && npm run lint:public-surface`
  (exit 0) plus a read of `git diff origin/main...HEAD -- api-surface.d.ts`,
  **not** a byte-diff of `lib/index.cjs` — `lib/` is gitignored, so
  `git show origin/main:lib/index.cjs` has no baseline, `$diff` is never
  assigned and the `if ($diff)` guard passes without comparing anything. See
  [docs/workflow/public-surface.md](./docs/workflow/public-surface.md)
- See [docs/workflow/pre-push.md](./docs/workflow/pre-push.md) for the full workflow

## Workflow

1. Branch from `main`: `git checkout -b fix/description`
2. Verify relevant focused tests with `npm run test:unit -- --runTestsByPath <test-path>`
3. Use normal commit hooks for their enabled gates, including lint and `npm run build` (tsup)
4. Let CI run full suites, coverage and approved real-bank E2E
5. Conventional commits: `fix:`, `feat:`, `refactor:`
6. PR → squash merge to main
7. release-please creates Release PR → merge to publish

## Key Files

> Paths here are verified by `npm run lint:doc-paths`. If you move a file,
> that gate fails until this list is updated — see
> [docs/workflow/doc-paths.md](./docs/workflow/doc-paths.md).

- `src/Scrapers/Base/Errors.ts` — `WafBlockError` with structured `IWafErrorDetails` (provider, httpStatus, pageTitle, pageUrl, suggestions)
- `src/Scrapers/Pipeline/Core/Builder/PipelineBuilder.ts` — `withOptions` / `withApiDirect` / `build`: assembles the two-slot pipeline
- `src/Scrapers/Pipeline/Core/Executor/PipelineExecutor.ts` — runs the phases, disposes the API mediator in `finally`
- `src/Scrapers/Pipeline/Phases/ApiDirectCall/ApiDirectCallPhase.ts` — login slot (HTTP login, OTP, durable token)
- `src/Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapePhase.ts` — scrape slot (accounts, transactions, balances)
- `src/Scrapers/Pipeline/Strategy/Fetch/HeadlessNativeFetchStrategy.ts` — the HTTP transport (cookies, redirects, mTLS)
- `src/Scrapers/Pipeline/Mediator/Timing/TimingActions.ts` — `humanDelay(min, max)`, `raceTimeout`, `runSerial`
- `src/Scrapers/Base/Interface.ts` — type definitions (`ScraperOptions`, `ScraperCredentials`, etc.)

## Changes from upstream

- Transport: every bank logs in and scrapes over HTTP (`ApiDirectCall` → `ApiDirectScrape`); no browser runs at scrape time
- `src/Scrapers/Base/Errors.ts`: `WafBlockError` carrying `IWafErrorDetails`
- No browser runtime, browser download, page hooks or browser install patch ships
- CI/CD: release-please + npm publish pipeline
