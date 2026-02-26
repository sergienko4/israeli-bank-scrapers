import { CompanyTypes } from '../definitions';
import { type ScraperOptions } from '../scrapers/interface';

type MockOverrides = Record<string, jest.Mock | ((...args: any[]) => any)>;

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
      cookies: jest.fn().mockResolvedValue([]),
    }),
    setDefaultTimeout: jest.fn(),
    goto: jest.fn().mockResolvedValue({ ok: () => true, status: () => 200 }),
    on: jest.fn(),
    screenshot: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

export function createMockContext(page?: any) {
  return {
    newPage: jest.fn().mockResolvedValue(page ?? createMockPage()),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

export function createMockBrowser(context?: any) {
  const mockCtx = context ?? createMockContext();
  return {
    newContext: jest.fn().mockResolvedValue(mockCtx),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

export function createMockScraperOptions(overrides: Partial<ScraperOptions> = {}): ScraperOptions {
  return {
    companyId: CompanyTypes.hapoalim,
    startDate: new Date('2024-01-01'),
    ...overrides,
  } as ScraperOptions;
}
