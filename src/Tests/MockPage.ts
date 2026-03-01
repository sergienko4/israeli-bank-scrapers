import { type Page } from 'playwright';
import { CompanyTypes } from '../Definitions';
import { type ScraperOptions } from '../Scrapers/Interface';

export type MockPage = {
  waitForSelector: jest.Mock;
  $eval: jest.Mock;
  $$eval: jest.Mock;
  $: jest.Mock;
  $$: jest.Mock;
  type: jest.Mock;
  selectOption: jest.Mock;
  waitForFunction: jest.Mock;
  frames: jest.Mock;
  waitForNavigation: jest.Mock;
  waitForResponse: jest.Mock;
  waitForRequest: jest.Mock;
  url: jest.Mock;
  title: jest.Mock;
  evaluate: jest.Mock;
  addInitScript: jest.Mock;
  setExtraHTTPHeaders: jest.Mock;
  context: jest.Mock;
  setDefaultTimeout: jest.Mock;
  goto: jest.Mock;
  on: jest.Mock;
  screenshot: jest.Mock;
  close: jest.Mock;
  focus: jest.Mock;
  cookies?: jest.Mock;
  [key: string]: jest.Mock | undefined;
};

type MockOverrides = Partial<MockPage>;

export function createMockPage(overrides: MockOverrides = {}): MockPage & Page {
  return {
    waitForSelector: jest.fn().mockResolvedValue(undefined),
    $eval: jest.fn().mockResolvedValue(undefined),
    $$eval: jest.fn().mockResolvedValue([]),
    $: jest.fn().mockResolvedValue({}),
    $$: jest.fn().mockResolvedValue([]),
    type: jest.fn().mockResolvedValue(undefined),
    selectOption: jest.fn().mockResolvedValue(undefined),
    waitForFunction: jest.fn().mockResolvedValue(undefined),
    frames: jest.fn().mockReturnValue([]),
    waitForNavigation: jest.fn().mockResolvedValue(undefined),
    waitForResponse: jest.fn().mockResolvedValue(undefined),
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
    focus: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as MockPage & Page;
}

type MockContext = {
  newPage: jest.Mock;
  close: jest.Mock;
};

export function createMockContext(page?: MockPage & Page): MockContext {
  return {
    newPage: jest.fn().mockResolvedValue(page ?? createMockPage()),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

type MockBrowser = {
  newContext: jest.Mock;
  close: jest.Mock;
};

export function createMockBrowser(context?: MockContext): MockBrowser {
  const mockCtx = context ?? createMockContext();
  return {
    newContext: jest.fn().mockResolvedValue(mockCtx),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

export function createMockScraperOptions(overrides: Partial<ScraperOptions> = {}): ScraperOptions {
  return {
    companyId: CompanyTypes.Hapoalim,
    startDate: new Date('2024-01-01'),
    ...overrides,
  } as ScraperOptions;
}
