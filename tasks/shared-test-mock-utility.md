# Task: Extract Shared Mock Utility for Puppeteer Page

## Problem

6 test files each define their own `createMockPage()` returning `as any`:

- `src/helpers/browser.test.ts`
- `src/helpers/elements-interactions.test.ts`
- `src/helpers/fetch.test.ts` (2 separate mocks)
- `src/helpers/navigation.test.ts`
- `src/helpers/storage.test.ts`

Each mock duplicates Puppeteer `Page` method stubs. If the Puppeteer API changes,
all 6 mocks silently become wrong. The `as any` casts bypass TypeScript entirely.

## Solution

Create `src/tests/mock-page.ts` with a typed mock factory:

```typescript
import { type Page } from 'puppeteer';

export function createMockPage(overrides: Partial<Record<keyof Page, jest.Mock>> = {}) {
  return {
    waitForSelector: jest.fn().mockResolvedValue(undefined),
    $eval: jest.fn().mockResolvedValue(undefined),
    $$eval: jest.fn().mockResolvedValue([]),
    $: jest.fn().mockResolvedValue({}),
    type: jest.fn().mockResolvedValue(undefined),
    select: jest.fn().mockResolvedValue(undefined),
    evaluate: jest.fn().mockResolvedValue(undefined),
    evaluateOnNewDocument: jest.fn().mockResolvedValue(undefined),
    setUserAgent: jest.fn().mockResolvedValue(undefined),
    setExtraHTTPHeaders: jest.fn().mockResolvedValue(undefined),
    waitForNavigation: jest.fn().mockResolvedValue(undefined),
    waitForFunction: jest.fn().mockResolvedValue(undefined),
    url: jest.fn().mockReturnValue('https://example.com'),
    frames: jest.fn().mockReturnValue([]),
    browser: jest.fn().mockReturnValue({
      version: jest.fn().mockResolvedValue('HeadlessChrome/131.0.6778.85'),
    }),
    ...overrides,
  } as unknown as Page & Record<string, jest.Mock>;
}
```

Then refactor each test file to import from `../tests/mock-page` instead of
defining its own factory.

## Also Fix

- `src/scrapers/base-scraper.test.ts:15` — `BaseScraper<any>` should use
  `BaseScraper<ScraperCredentials>` for type safety
- `src/scrapers/base-scraper.test.ts:12` — `as ScraperOptions` cast should
  be replaced with a complete options object or a typed test helper

## Acceptance Criteria

- [ ] Single `createMockPage()` in `src/tests/mock-page.ts`
- [ ] All 6 test files import from shared utility
- [ ] Zero `as any` on mock page objects
- [ ] `BaseScraper<ScraperCredentials>` in base-scraper.test.ts
- [ ] All tests still pass
- [ ] ESLint clean
