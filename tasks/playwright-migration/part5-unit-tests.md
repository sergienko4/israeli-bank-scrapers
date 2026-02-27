# Part 5: Unit Test Infrastructure

## Goal
Update mock-page.ts and all 13 unit test files to mock Playwright instead of Puppeteer.

## Files to Modify

### `src/tests/mock-page.ts`

**Remove** Puppeteer-specific mocks:
- `select` → rename to `selectOption`
- `evaluateOnNewDocument` → rename to `addInitScript`
- `setUserAgent` → remove (no page-level UA in Playwright)
- `setCacheEnabled` → remove (no page-level equivalent)
- `setViewport` → remove (set at context level)
- `setRequestInterception` → remove (Playwright uses `page.route()`)
- `emulateTimezone` → remove (set at context level)
- `browser()` mock → remove (Playwright: `page.context().browser()`)

**Add** Playwright-specific mocks:
- `selectOption: jest.fn().mockResolvedValue(undefined)`
- `addInitScript: jest.fn().mockResolvedValue(undefined)`
- `context: jest.fn().mockReturnValue({ browser: () => ({ version: () => 'chromium-131' }) })`

**Resulting mock-page.ts:**
```ts
export function createMockPage(overrides: MockOverrides = {}): any {
  return {
    waitForSelector: jest.fn().mockResolvedValue(undefined),
    $eval: jest.fn().mockResolvedValue(undefined),
    $$eval: jest.fn().mockResolvedValue([]),
    $: jest.fn().mockResolvedValue({}),
    type: jest.fn().mockResolvedValue(undefined),
    selectOption: jest.fn().mockResolvedValue(undefined),
    waitForFunction: jest.fn().mockResolvedValue(undefined),
    frames: jest.fn().mockReturnValue([]),
    waitForNavigation: jest.fn().mockResolvedValue(undefined),
    url: jest.fn().mockReturnValue('https://example.com'),
    title: jest.fn().mockResolvedValue('Test Page'),
    evaluate: jest.fn().mockResolvedValue(undefined),
    addInitScript: jest.fn().mockResolvedValue(undefined),
    setExtraHTTPHeaders: jest.fn().mockResolvedValue(undefined),
    context: jest.fn().mockReturnValue({
      browser: () => ({ version: () => 'chromium-131' }),
    }),
    setDefaultTimeout: jest.fn(),
    goto: jest.fn().mockResolvedValue({ ok: () => true, status: () => 200 }),
    on: jest.fn(),
    screenshot: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
```

---

### 13 Unit Test Files — Mechanical Pattern

All 13 test files use the identical mock pattern. Apply this transformation to each:

```ts
// BEFORE
import puppeteer from 'puppeteer';
jest.mock('puppeteer', () => ({ launch: jest.fn() }));
// ... in beforeEach:
(puppeteer.launch as jest.Mock).mockResolvedValue(mockBrowser);

// AFTER
import { chromium } from 'playwright';
jest.mock('playwright', () => ({ chromium: { launch: jest.fn() } }));
// ... in beforeEach:
(chromium.launch as jest.Mock).mockResolvedValue(mockBrowser);
```

**Mock browser object** — add `newContext` layer:
```ts
// BEFORE
const mockBrowser = {
  newPage: jest.fn().mockResolvedValue(mockPage),
  close: jest.fn().mockResolvedValue(undefined),
  version: jest.fn().mockResolvedValue('HeadlessChrome/131'),
};

// AFTER
const mockContext = {
  newPage: jest.fn().mockResolvedValue(mockPage),
  close: jest.fn().mockResolvedValue(undefined),
};
const mockBrowser = {
  newContext: jest.fn().mockResolvedValue(mockContext),
  close: jest.fn().mockResolvedValue(undefined),
};
```

**Files (13 total):**
1. `src/scrapers/base-scraper-with-browser.test.ts`
2. `src/scrapers/base-isracard-amex.test.ts`
3. `src/scrapers/base-beinleumi-group.test.ts`
4. `src/scrapers/behatsdaa.test.ts`
5. `src/scrapers/beyahad-bishvilha.test.ts`
6. `src/scrapers/discount.test.ts`
7. `src/scrapers/hapoalim.test.ts`
8. `src/scrapers/leumi.test.ts`
9. `src/scrapers/max.test.ts`
10. `src/scrapers/mizrahi.test.ts`
11. `src/scrapers/union-bank.test.ts`
12. `src/scrapers/visa-cal.test.ts`
13. `src/scrapers/yahav.test.ts`

---

### `base-scraper-with-browser.test.ts` — Additional Changes

Beyond the mechanical mock swap, this test has specific assertions to update:

**Line 97:** `expect(puppeteer.launch).toHaveBeenCalled()` → `expect(chromium.launch).toHaveBeenCalled()`

**Line 98:** `expect(mockBrowser.newPage).toHaveBeenCalled()` → `expect(mockBrowser.newContext).toHaveBeenCalled()`

**Lines 116-122** — viewport test: Either update to check `newContext` was called with viewport option, or remove (viewport is now in context options, not a page-level call).

**Line 132:** `expect(puppeteer.launch).not.toHaveBeenCalled()` → `expect(chromium.launch).not.toHaveBeenCalled()`

**Line 137:** External browser: `browser.newPage` mock → needs `browser.newContext` returning context with `newPage`

**Lines 140-141:** Same pattern changes

**Line 155:** `expect(puppeteer.launch).toHaveBeenCalledWith(...)` → `expect(chromium.launch).toHaveBeenCalledWith(...)`

**Lines 238-244** — setUserAgent test: Remove this test entirely (Playwright has no page-level setUserAgent). Or update to verify context options.

## Validation
```bash
npm test                         # ALL unit tests pass
npm test -- --coverage 2>&1 | grep "All files"
# branches ≥ 76, functions ≥ 76, lines ≥ 88, statements ≥ 86
```

## Expected State After
- `npm test` passes all ~381 unit tests
- Coverage thresholds met
- Zero references to `puppeteer` in test files
- Mock structure matches Playwright's API shape
