import { CompanyTypes } from '../definitions';
import { type ScraperOptions } from '../scrapers/interface';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockOverrides = Record<string, jest.Mock | ((...args: any[]) => any)>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createMockPage(overrides: MockOverrides = {}): any {
  return {
    waitForSelector: jest.fn().mockResolvedValue(undefined),
    $eval: jest.fn().mockResolvedValue(undefined),
    $$eval: jest.fn().mockResolvedValue([]),
    $: jest.fn().mockResolvedValue({}),
    type: jest.fn().mockResolvedValue(undefined),
    select: jest.fn().mockResolvedValue(undefined),
    waitForFunction: jest.fn().mockResolvedValue(undefined),
    frames: jest.fn().mockReturnValue([]),
    waitForNavigation: jest.fn().mockResolvedValue(undefined),
    url: jest.fn().mockReturnValue('https://example.com'),
    evaluate: jest.fn().mockResolvedValue(undefined),
    evaluateOnNewDocument: jest.fn().mockResolvedValue(undefined),
    setUserAgent: jest.fn().mockResolvedValue(undefined),
    setExtraHTTPHeaders: jest.fn().mockResolvedValue(undefined),
    browser: jest.fn().mockReturnValue({
      version: jest.fn().mockResolvedValue('HeadlessChrome/131.0.6778.85'),
    }),
    ...overrides,
  };
}

export function createMockScraperOptions(overrides: Partial<ScraperOptions> = {}): ScraperOptions {
  return {
    companyId: CompanyTypes.hapoalim,
    startDate: new Date('2024-01-01'),
    ...overrides,
  } as ScraperOptions;
}
