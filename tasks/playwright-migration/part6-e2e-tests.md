# Part 6: E2E Mocked Tests

## Goal
Update all E2E mocked test infrastructure to use Playwright's real browser and routing APIs.

## Files to Modify

### `src/tests/e2e-mocked/helpers/browser-fixture.ts`

```ts
// BEFORE
import puppeteer, { type Browser } from 'puppeteer';
const BROWSER_ARGS = [
  '--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu',
  '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled',
];
sharedBrowser = await puppeteer.launch({ headless: true, args: BROWSER_ARGS });

// AFTER
import { chromium, type Browser } from 'playwright';
const BROWSER_ARGS = [
  '--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu',
  '--disable-dev-shm-usage',
];
sharedBrowser = await chromium.launch({ headless: true, args: BROWSER_ARGS });
```

Remove `--disable-blink-features=AutomationControlled` (Playwright handles internally).

---

### `src/tests/e2e-mocked/helpers/request-interceptor.ts`

Complete rewrite — Playwright uses `page.route()` instead of `setRequestInterception`:

```ts
// BEFORE
import { type Page, type HTTPRequest } from 'puppeteer';
interface MockRoute {
  body: string | ((request: HTTPRequest) => string);
  ...
}
await page.setRequestInterception(true);
page.on('request', (request: HTTPRequest) => {
  void request.respond({ status, contentType, body }, INTERCEPTION_PRIORITY);
  void request.continue(undefined, 0);
});

// AFTER
import { type Page, type Request, type Route } from 'playwright';
interface MockRoute {
  body: string | ((request: Request) => string);
  ...
}
await page.route('**/*', async (route: Route, request: Request) => {
  for (const mockRoute of routes) {
    const urlMatch = mockRoute.match instanceof RegExp
      ? mockRoute.match.test(request.url())
      : request.url().includes(mockRoute.match);
    const methodMatch = !mockRoute.method || mockRoute.method === request.method();
    if (urlMatch && methodMatch) {
      const body = typeof mockRoute.body === 'function' ? mockRoute.body(request) : mockRoute.body;
      await route.fulfill({
        status: mockRoute.status ?? 200,
        contentType: mockRoute.contentType,
        body,
      });
      return;
    }
  }
  await route.continue();
});
```

Remove `INTERCEPTION_PRIORITY` constant (Playwright routes are ordered by registration).

---

### `src/tests/e2e-mocked/anti-detection.e2e-mocked.test.ts`

**Major rewrite** — this test verifies stealth overrides that no longer exist. Replace with tests that verify Playwright context options produce the expected browser state:

- `hides navigator.webdriver` → verify `navigator.webdriver` is false/undefined with Playwright (it handles this natively)
- `sets realistic user agent` → verify `navigator.userAgent` matches expected pattern (set via context options)
- `sets Hebrew language preferences` → verify `navigator.languages` contains `he-IL`
- `defines window.chrome object` → may not be needed (Playwright doesn't need this)
- `sets client hints headers on requests` → verify headers via `page.route()` inspection

Remove `applyAntiDetection` import — function no longer exists.
Instead, create page via `browser.newContext(buildContextOptions())` and verify the results.

Remove `page.setRequestInterception(true)` call — use `page.route()` pattern.

---

### 5 E2E Test Files — Import Changes

All use `import { type Browser } from 'puppeteer'` → `from 'playwright'`:

1. **`amex.e2e-mocked.test.ts`**: Import change only
2. **`isracard.e2e-mocked.test.ts`**: Import change only
3. **`error-scenarios.e2e-mocked.test.ts`**: Import change only
4. **`external-browser.e2e-mocked.test.ts`**:
   - Import change
   - `browser.createBrowserContext()` → `browser.newContext()` (if used)
   - Check if `browser.newPage()` is used — it still works in Playwright (creates default context)

## Pre-flight Check
Before starting, ensure Playwright browser is installed:
```bash
npx playwright install chromium
```

## Validation
```bash
npx playwright install chromium
npx jest --testPathPatterns='e2e-mocked' --testPathIgnorePatterns='/node_modules/' --verbose
# Expect: all E2E mocked tests pass (17 tests or slightly fewer if anti-detection tests consolidated)
```

## Expected State After
- E2E tests use real Playwright browser
- Request interception uses `page.route()` pattern
- Anti-detection tests verify context-level settings, not stealth overrides
- All E2E mocked tests pass
