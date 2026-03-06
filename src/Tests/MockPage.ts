import { randomBytes, randomInt } from 'crypto';
import { type Page } from 'playwright';

import { CompanyTypes } from '../Definitions';
import { type ScraperOptions } from '../Scrapers/Base/Interface';

export interface MockPage {
  waitForSelector: jest.Mock;
  $eval: jest.Mock;
  $$eval: jest.Mock;
  $: jest.Mock;
  $$: jest.Mock;
  type: jest.Mock;
  selectOption: jest.Mock;
  waitForFunction: jest.Mock;
  frames: jest.Mock;
  waitForLoadState: jest.Mock;
  waitForNavigation: jest.Mock;
  waitForURL: jest.Mock;
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
  locator?: jest.Mock;
  cookies?: jest.Mock;
  [key: string]: jest.Mock | undefined;
}

/**
 * Creates a mock Playwright Page with jest spies for all common page methods.
 *
 * @param overrides - optional mock overrides to customize specific page methods
 * @returns a mock Page object typed as both MockPage and Playwright Page
 */
export function createMockPage(overrides: Partial<MockPage> = {}): MockPage & Page {
  /**
   * Mock browser version stub returned by the context.browser() method.
   *
   * @returns the mock Chromium version string
   */
  const mockBrowserVersionStub = (): string => 'chromium-131';
  /**
   * Mock browser stub returned by the context() method.
   *
   * @returns a minimal browser object with a version stub
   */
  const mockBrowserStub = (): { version: () => string } => ({ version: mockBrowserVersionStub });
  /**
   * Mock ok response predicate for goto responses.
   *
   * @returns true to indicate a successful navigation response
   */
  const mockOk = (): boolean => true;
  /**
   * Mock status response accessor for goto responses.
   *
   * @returns 200 as the mock HTTP status code
   */
  const mockStatus = (): number => 200;
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
    waitForLoadState: jest.fn().mockResolvedValue(undefined),
    waitForNavigation: jest.fn().mockResolvedValue(undefined),
    waitForURL: jest.fn().mockResolvedValue(undefined),
    waitForResponse: jest.fn().mockResolvedValue(undefined),
    url: jest.fn().mockReturnValue('https://example.com'),
    title: jest.fn().mockResolvedValue('Test Page'),
    evaluate: jest.fn().mockResolvedValue(undefined),
    addInitScript: jest.fn().mockResolvedValue(undefined),
    setExtraHTTPHeaders: jest.fn().mockResolvedValue(undefined),
    context: jest.fn().mockReturnValue({
      browser: mockBrowserStub,
      cookies: jest.fn().mockResolvedValue([]),
    }),
    setDefaultTimeout: jest.fn(),
    goto: jest.fn().mockResolvedValue({ ok: mockOk, status: mockStatus }),
    on: jest.fn(),
    screenshot: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    focus: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as MockPage & Page;
}

/**
 * Creates a mock browser context with jest spies for newPage and close.
 *
 * @param page - optional mock page to return from newPage; creates a new one if omitted
 * @returns a mock context object with newPage and close mocks
 */
export function createMockContext(page?: MockPage & Page): {
  newPage: jest.Mock;
  close: jest.Mock;
} {
  const resolvedPage = page ?? createMockPage();
  return {
    newPage: jest.fn().mockResolvedValue(resolvedPage),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

/**
 * Creates a mock browser with jest spies for newContext and close.
 *
 * @param context - optional mock context to return from newContext; creates a new one if omitted
 * @param context.newPage - mock function to create a new page in the context
 * @param context.close - mock function to close the context
 * @returns a mock browser object with newContext and close mocks
 */
export function createMockBrowser(context?: { newPage: jest.Mock; close: jest.Mock }): {
  newContext: jest.Mock;
  close: jest.Mock;
} {
  const mockCtx = context ?? createMockContext();
  return {
    newContext: jest.fn().mockResolvedValue(mockCtx),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

/**
 * Creates a ScraperOptions object with sane defaults for unit tests.
 *
 * @param overrides - optional partial options to override the defaults
 * @returns a complete ScraperOptions object for use in test scrapers
 */
export function createMockScraperOptions(overrides: Partial<ScraperOptions> = {}): ScraperOptions {
  return {
    companyId: CompanyTypes.Hapoalim,
    startDate: new Date('2024-01-01'),
    ...overrides,
  } as ScraperOptions;
}

/**
 * Generates unique fake credentials for a unit test.
 * Values are clearly mock data — never real credentials.
 * Using a generator (vs hardcoded constants) ensures no real credentials
 * accidentally end up in test source files.
 *
 * @param prefix - optional prefix for the username and email to identify the test context
 * @returns an object with mock username, password, id, email, and card6Digits fields
 */
export function createMockCredentials(prefix = 'bank'): {
  username: string;
  password: string;
  id: string;
  email: string;
  card6Digits: string;
} {
  const runId = randomBytes(3).toString('hex'); // 6 hex chars, cryptographically random
  const cardNum = randomInt(100000, 1000000);
  return {
    username: `mock.${prefix}.user.${runId}`,
    password: `MockPwd${runId}`,
    id: `mock_id_${runId}`,
    email: `mock.${prefix}.${runId}@test.example`,
    card6Digits: String(cardNum),
  };
}
