# Part 2: Types & Core Engine

## Goal
Update the public API types and rewrite the core browser engine to use Playwright.

## Files to Modify

### `src/scrapers/interface.ts`

**Line 1** — import change:
```ts
// BEFORE
import { type BrowserContext, type Browser, type Page } from 'puppeteer';

// AFTER
import { type BrowserContext, type Browser, type Page } from 'playwright';
```

**Update JSDoc comments:**
- Line 41: `puppeteer.launch()` → `chromium.launch()`
- Line 67: `puppeteer` → `playwright` in executablePath comment
- Line 135: remove "puppeteer's" from `page.setDefaultTimeout` comment

---

### `src/scrapers/base-scraper-with-browser.ts`

**Imports (lines 1-2, 5):**
```ts
// BEFORE
import puppeteer from 'puppeteer';
import { type Frame, type Page, type PuppeteerLifeCycleEvent } from 'puppeteer';
import { applyAntiDetection } from '../helpers/browser';

// AFTER
import { chromium } from 'playwright';
import { type Frame, type Page } from 'playwright';
import { buildContextOptions } from '../helpers/browser';
```

**LoginOptions.waitUntil (line 46):**
```ts
// BEFORE
waitUntil?: PuppeteerLifeCycleEvent;

// AFTER
waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
```

**navigateTo signature (line 206):**
```ts
// BEFORE
waitUntil: PuppeteerLifeCycleEvent | undefined = 'load',

// AFTER
waitUntil: 'load' | 'domcontentloaded' | 'networkidle' | 'commit' | undefined = 'load',
```

**initialize() method (lines 107-147):**
- Remove `page.setCacheEnabled(false)` (line 113)
- Remove `applyAntiDetection(this.page)` call (lines 133-135)
- Remove `page.setViewport()` call (lines 137-142) — viewport moves to context options
- Keep: `page.setDefaultTimeout()`, `preparePage()`, `page.on('requestfailed')`

**initializePage() — external browser path (line 170):**
```ts
// BEFORE
return browser.newPage();

// AFTER
const context = await browser.newContext(buildContextOptions(this.getViewPort()));
this.cleanups.push(async () => context.close());
return context.newPage();
```

**initializePage() — default launch path (lines 173-201):**
```ts
// BEFORE
const launchArgs = args.includes('--disable-blink-features=AutomationControlled')
  ? args
  : [...args, '--disable-blink-features=AutomationControlled'];

const browser = await puppeteer.launch({
  env: this.options.verbose ? { DEBUG: '*', ...process.env } : undefined,
  headless,
  executablePath,
  args: launchArgs,
  timeout,
});
// ... cleanups ...
return browser.newPage();

// AFTER
const browser = await chromium.launch({
  headless,
  executablePath,
  args,
  timeout,
});
// ... cleanups ...
const context = await browser.newContext(buildContextOptions(this.getViewPort()));
this.cleanups.push(async () => context.close());
return context.newPage();
```

Key changes:
- Remove `--disable-blink-features=AutomationControlled` injection (Playwright handles internally)
- Remove `env` option (not supported by Playwright's launch)
- Add `browser.newContext(buildContextOptions(...))` between launch and newPage
- Context gets UA, locale, timezone, viewport, headers

**navigateTo() — remove Cloudflare redirect (line 220):**
```ts
// BEFORE
if (status === 403) return this.handleCloudflareChallenge(url);

// AFTER
// Just throw — no Cloudflare handling needed with Playwright
```

**DELETE Cloudflare methods (lines 224-265):**
- `handleCloudflareChallenge()`
- `tryChallengeAttempt()`
- `backoffAndReload()`
- `isCloudflareTitle()`
- `tryWaitForChallenge()`

**Remove WafBlockError import** if no longer used after Cloudflare code removal.
Check: `WafBlockError.cloudflareBlock()` was only called in `handleCloudflareChallenge`. If no other usage exists, remove the import.

**login() method — remove setUserAgent (lines 292-294):**
```ts
// DELETE these lines (Playwright has no page-level setUserAgent):
if (loginOptions.userAgent) {
  debug('set custom user agent provided in options');
  await this.page.setUserAgent(loginOptions.userAgent);
}
```
Also remove `userAgent` from `LoginOptions` interface if no scraper uses it meaningfully.

## Validation
```bash
npx tsc --noEmit 2>&1 | grep "error TS" | wc -l
# Expect: still many errors (helpers + scrapers still import 'puppeteer')
# But interface.ts and base-scraper-with-browser.ts should compile
```

## Expected State After
- Core engine uses `chromium.launch()` → `newContext()` → `newPage()`
- All Cloudflare retry code deleted (~80 lines)
- Anti-detection moved to context options (via buildContextOptions)
- Still broken: browser.ts needs rewrite (buildContextOptions doesn't exist yet)
