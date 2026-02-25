# Claude Code Instructions — israeli-bank-scrapers (Fork)

## Project

Fork of [eshaham/israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers) with WAF bypass fixes for Amex/Isracard.

Published as `@sergienko4/israeli-bank-scrapers` on npm.

## Code Quality

- SOLID principles, especially OCP (maps over if/else)
- Max 10 lines per method — extract helpers
- TypeScript strict mode — no `any`, no unused vars
- Follow existing style: Prettier (120 width, single quotes, trailing commas) + ESLint 9 flat config

## Workflow

1. Branch from `main`: `git checkout -b fix/description`
2. Build: `npm run build` (Babel + TSC)
3. Test: `npm test` (Jest)
4. Lint: `npm run lint`
5. Conventional commits: `fix:`, `feat:`, `refactor:`
6. PR → squash merge to main
7. release-please creates Release PR → merge to publish

## Key Files

- `src/helpers/browser.ts` — bank-specific anti-detection (Hebrew UA, client hints, Israel timezone)
- `src/helpers/elements-interactions.ts` — human-like delays on fillInput/clickButton
- `src/scrapers/base-isracard-amex.ts` — shared Amex/Isracard scraper with WAF bypass
- `src/scrapers/base-scraper-with-browser.ts` — base class, uses puppeteer-extra with stealth plugin
- `src/scrapers/interface.ts` — type definitions (ScraperOptions, ScraperCredentials, etc.)

## Changes from upstream

- Anti-detection: `puppeteer-extra-plugin-stealth` (17 evasion modules) + Hebrew locale + Israel timezone
- `src/helpers/browser.ts`: Bank-specific UA, client hints, Hebrew locale override
- `src/scrapers/base-scraper-with-browser.ts`: Uses `puppeteer-extra` with stealth plugin
- `src/helpers/elements-interactions.ts`: Human-like delays (300-1200ms) on form interactions
- `src/scrapers/base-isracard-amex.ts`: Better error messages for WAF blocks
- CI/CD: release-please + npm publish pipeline
