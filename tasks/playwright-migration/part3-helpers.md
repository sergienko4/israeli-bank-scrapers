# Part 3: Helper Files

## Goal
Rewrite browser.ts (remove stealth), fix evaluate syntax in fetch.ts, adapt Playwright API differences in elements-interactions.ts and navigation.ts.

## Files to Modify

### `src/helpers/browser.ts` — near-complete rewrite

**BEFORE** (65 lines): `getChromeVersion`, `setRealisticUserAgent`, `setRealisticHeaders`, `applyStealthOverrides`, `applyAntiDetection`

**AFTER** (~25 lines): Export `buildContextOptions()` returning Playwright `BrowserContextOptions`

```ts
import { type BrowserContextOptions } from 'playwright';

const CHROME_VERSION = '131';
const HEBREW_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION}.0.0.0 Safari/537.36`;

export function buildContextOptions(
  viewport: { width: number; height: number } = { width: 1024, height: 768 },
): BrowserContextOptions {
  return {
    userAgent: HEBREW_UA,
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    viewport,
    extraHTTPHeaders: {
      'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
      'sec-ch-ua': `"Google Chrome";v="${CHROME_VERSION}", "Chromium";v="${CHROME_VERSION}", "Not_A Brand";v="24"`,
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    },
  };
}
```

---

### `src/helpers/fetch.ts`

**Line 1** — import:
```ts
// BEFORE
import { type Page } from 'puppeteer';
// AFTER
import { type Page } from 'playwright';
```

**Lines 121-140** — `fetchPostWithinPage` multi-arg → single-arg evaluate:
```ts
// BEFORE
const [text, status] = await page.evaluate(
  async (innerUrl: string, innerData: Record<string, any>, innerExtraHeaders: Record<string, any>) => {
    const response = await fetch(innerUrl, { ... });
    ...
  },
  url,
  data,
  extraHeaders,
);

// AFTER
const [text, status] = await page.evaluate(
  async ({ innerUrl, innerData, innerExtraHeaders }: {
    innerUrl: string;
    innerData: Record<string, any>;
    innerExtraHeaders: Record<string, any>;
  }) => {
    const response = await fetch(innerUrl, {
      method: 'POST',
      body: JSON.stringify(innerData),
      credentials: 'include',
      headers: Object.assign(
        { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        innerExtraHeaders,
      ),
    });
    if (response.status === 204) {
      return [null, 204] as const;
    }
    return [await response.text(), response.status] as const;
  },
  { innerUrl: url, innerData: data, innerExtraHeaders: extraHeaders },
);
```

---

### `src/helpers/elements-interactions.ts`

**Line 1** — import:
```ts
// BEFORE
import { type Frame, type Page } from 'puppeteer';
// AFTER
import { type Frame, type Page } from 'playwright';
```

**Line 10** — `waitUntilElementFound`:
```ts
// BEFORE
await page.waitForSelector(elementSelector, { visible: onlyVisible, timeout });
// AFTER
await page.waitForSelector(elementSelector, {
  state: onlyVisible ? 'visible' : 'attached',
  timeout,
});
```

**Line 14** — `waitUntilElementDisappear`:
```ts
// BEFORE
await page.waitForSelector(elementSelector, { hidden: true, timeout });
// AFTER
await page.waitForSelector(elementSelector, { state: 'hidden', timeout });
```

**Line 125** — `dropdownSelect`:
```ts
// BEFORE
await page.select(selectSelector, value);
// AFTER
await page.selectOption(selectSelector, value);
```

**No changes needed for**: `$eval`, `$$eval`, `page.type()`, `page.waitForFunction()`, `page.$()`, `page.evaluate()` — all compatible.

---

### `src/helpers/navigation.ts`

**Line 1** — import:
```ts
// BEFORE
import { type Frame, type Page, type WaitForOptions } from 'puppeteer';
// AFTER
import { type Frame, type Page } from 'playwright';
```

**Add local type definition** (WaitForOptions doesn't exist in Playwright):
```ts
type WaitUntilState = 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
interface WaitForOptions {
  waitUntil?: WaitUntilState;
  timeout?: number;
}
```

---

### `src/helpers/storage.ts`

**Line 1** — import only:
```ts
// BEFORE
import { type Page } from 'puppeteer';
// AFTER
import { type Page } from 'playwright';
```

## Validation
```bash
npx tsc --noEmit 2>&1 | grep "error TS" | wc -l
# Expect: errors reduced to scraper files + test files only
# All helper files should compile cleanly
```

## Expected State After
- browser.ts: ~40 lines deleted (stealth code), replaced with `buildContextOptions()`
- fetch.ts: multi-arg evaluate fixed for Playwright
- elements-interactions.ts: `waitForSelector` and `select` adapted
- navigation.ts: local WaitForOptions type
- storage.ts: import changed
