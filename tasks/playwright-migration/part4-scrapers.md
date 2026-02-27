# Part 4: Scraper Files

## Goal
Update all scraper files from Puppeteer to Playwright imports and fix API differences.

## Files to Modify

### Group A — Import-only changes (9 files)

Each file: `import { type Page } from 'puppeteer'` → `import { type Page } from 'playwright'`

1. `src/scrapers/hapoalim.ts`
2. `src/scrapers/discount.ts`
3. `src/scrapers/max.ts`
4. `src/scrapers/union-bank.ts`
5. `src/scrapers/yahav.ts`
6. `src/scrapers/pagi.ts`
7. `src/scrapers/otsar-hahayal.ts`
8. `src/scrapers/one-zero.ts`
9. `src/scrapers/massad.ts` (verify if it has a puppeteer import)

---

### Group B — Import + API changes (6 files)

#### `src/scrapers/base-isracard-amex.ts`
```ts
// BEFORE
import { type Page } from 'puppeteer';
// AFTER
import { type Page } from 'playwright';
```
No other API changes — `page.on('response')`, `page.waitForFunction()`, `page.url()`, `page.title()` all identical.

#### `src/scrapers/leumi.ts`
```ts
// BEFORE
import { type Page } from 'puppeteer';
// AFTER
import { type Page } from 'playwright';
```

API changes:
- `networkidle2` → `networkidle` (search for `waitForNavigation(page, { waitUntil: 'networkidle2' })`)
- XPath prefix: `'xpath//...'` → `'xpath=//...'` (search for all `xpath` strings)
- `waitForSelector(xpath, { visible: true })` → `waitForSelector(xpath, { state: 'visible' })` (if any)

#### `src/scrapers/mizrahi.ts`
```ts
// BEFORE
import { type Frame, type HTTPRequest, type Page } from 'puppeteer';
// AFTER
import { type Frame, type Page, type Request } from 'playwright';
```

API changes:
- All `HTTPRequest` type references → `Request`
- XPath prefix in `$$()` calls: ensure `xpath=` prefix (search for `'xpath' +` string concat)
- `page.waitForRequest()`, `request.postData()`, `request.headers()` — same API, no changes

#### `src/scrapers/visa-cal.ts`
```ts
// BEFORE
import { type HTTPRequest, type Frame, type Page } from 'puppeteer';
// AFTER
import { type Frame, type Page, type Request } from 'playwright';
```

API changes:
- All `HTTPRequest` type references → `Request`
- `page.waitForRequest()`, `request.headers().authorization` — same API, no changes

#### `src/scrapers/base-beinleumi-group.ts`
```ts
// BEFORE
import { type Frame, type Page } from 'puppeteer';
// AFTER
import { type Frame, type Page } from 'playwright';
```

API changes:
- `page.select('#account_num_select', accountId)` → `page.selectOption('#account_num_select', accountId)`
- `page.evaluate()`, `page.$$eval()`, `page.$()`, `ElementHandle` usage — all compatible

#### `src/scrapers/beyahad-bishvilha.ts`
```ts
// BEFORE
import { type Page } from 'puppeteer';
// AFTER
import { type Page } from 'playwright';
```

API changes:
- XPath prefix: `'xpath//...'` → `'xpath=//...'` if it uses the wrong prefix

#### `src/scrapers/behatsdaa.ts`
- Import change (if it has direct puppeteer import)
- Verify XPath prefix (already uses `xpath=` based on exploration)

## Pre-flight Check
Before starting, grep for all puppeteer references in scrapers:
```bash
grep -rn "from 'puppeteer'" src/scrapers/ --include="*.ts" | grep -v ".test.ts"
```

And grep for all XPath usage:
```bash
grep -rn "xpath" src/scrapers/ --include="*.ts" | grep -v ".test.ts"
```

## Validation
```bash
npx tsc --noEmit 2>&1 | grep "error TS" | wc -l
# Expect: 0 errors in production code
# Remaining errors should be test files only
```

## Expected State After
- All production `.ts` files compile with `playwright` imports
- Zero `puppeteer` references in `src/scrapers/*.ts` (excluding test files)
- All XPath selectors use `xpath=` prefix
- `select()` → `selectOption()` in beinleumi
- `HTTPRequest` → `Request` in mizrahi, visa-cal
- `networkidle2` → `networkidle` in leumi
