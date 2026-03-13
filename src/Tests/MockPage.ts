import { jest } from '@jest/globals';
import { type Page } from 'playwright';

import { CompanyTypes } from '../Definitions.js';
import { type ScraperOptions } from '../Scrapers/Base/Interface.js';

/** Chainable mock for Playwright Locator (first/evaluate/click/innerText/etc.). */
export interface IMockLocator {
  first: jest.Mock;
  click: jest.Mock;
  fill: jest.Mock;
  innerText: jest.Mock;
  textContent: jest.Mock;
  getAttribute: jest.Mock;
  evaluate: jest.Mock;
  evaluateAll: jest.Mock;
  isVisible: jest.Mock;
  waitFor: jest.Mock;
  count: jest.Mock;
  pressSequentially: jest.Mock;
}

/**
 * Create a chainable mock Playwright Locator.
 * @param overrides - optional overrides for locator methods.
 * @returns a mock locator whose .first() returns itself.
 */
export function createMockLocator(overrides: Partial<IMockLocator> = {}): IMockLocator {
  const loc: IMockLocator = {
    first: jest.fn(),
    click: jest.fn().mockResolvedValue(undefined),
    fill: jest.fn().mockResolvedValue(undefined),
    innerText: jest.fn().mockResolvedValue(''),
    textContent: jest.fn().mockResolvedValue(''),
    getAttribute: jest.fn().mockResolvedValue(null),
    evaluate: jest.fn().mockResolvedValue(undefined),
    evaluateAll: jest.fn().mockResolvedValue([]),
    isVisible: jest.fn().mockResolvedValue(true),
    waitFor: jest.fn().mockResolvedValue(undefined),
    count: jest.fn().mockResolvedValue(0),
    pressSequentially: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  loc.first.mockReturnValue(loc);
  return loc;
}

export interface IMockPage {
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
  waitForURL: jest.Mock;
  waitForResponse: jest.Mock;
  waitForRequest: jest.Mock;
  waitForTimeout: jest.Mock;
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
  click: jest.Mock;
  locator: jest.Mock;
  getByText: jest.Mock;
  getByRole: jest.Mock;
  getByLabel: jest.Mock;
  cookies?: jest.Mock;
  [key: string]: jest.Mock | undefined;
}

type MockOverrides = Partial<IMockPage>;

/** Default locator instance shared by all fresh mock pages. */
const DEFAULT_LOCATOR = createMockLocator();

/**
 * Creates a mock Playwright Page with sensible jest.fn() stubs.
 * @param overrides - optional mock overrides for specific page methods
 * @returns a mock Page instance for unit testing
 */
export function createMockPage(overrides: MockOverrides = {}): IMockPage & Page {
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
    mainFrame: jest.fn().mockReturnValue(null),
    waitForNavigation: jest.fn().mockResolvedValue(undefined),
    waitForURL: jest.fn().mockResolvedValue(undefined),
    waitForResponse: jest.fn().mockResolvedValue(undefined),
    url: jest.fn().mockReturnValue('https://example.com'),
    title: jest.fn().mockResolvedValue('Test Page'),
    evaluate: jest.fn().mockResolvedValue(undefined),
    addInitScript: jest.fn().mockResolvedValue(undefined),
    setExtraHTTPHeaders: jest.fn().mockResolvedValue(undefined),
    /**
     * Returns a mock browser context.
     * @returns context stub with browser and cookies
     */
    context: jest.fn().mockReturnValue({
      /**
       * Returns the mock browser.
       * @returns browser stub with version
       */
      browser: () => ({
        /**
         * Returns the browser version string.
         * @returns hardcoded chromium version
         */
        version: () => 'chromium-131',
      }),
      cookies: jest.fn().mockResolvedValue([]),
    }),
    setDefaultTimeout: jest.fn(),
    /**
     * Mock goto that returns a successful response.
     * @returns response stub with ok and status
     */
    goto: jest.fn().mockResolvedValue({
      /**
       * Returns whether the response was OK.
       * @returns true
       */
      ok: () => true,
      /**
       * Returns the HTTP status code.
       * @returns 200
       */
      status: () => 200,
    }),
    on: jest.fn(),
    screenshot: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    focus: jest.fn().mockResolvedValue(undefined),
    click: jest.fn().mockResolvedValue(undefined),
    locator: jest.fn().mockReturnValue(DEFAULT_LOCATOR),
    getByText: jest.fn().mockReturnValue(DEFAULT_LOCATOR),
    getByRole: jest.fn().mockReturnValue(DEFAULT_LOCATOR),
    getByLabel: jest.fn().mockReturnValue(DEFAULT_LOCATOR),
    waitForRequest: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as IMockPage & Page;
}

interface IMockContext {
  newPage: jest.Mock;
  close: jest.Mock;
}

/**
 * Creates a mock browser context with newPage and close stubs.
 * @param page - optional mock page to return from newPage()
 * @returns a mock browser context
 */
export function createMockContext(page?: IMockPage & Page): IMockContext {
  return {
    newPage: jest.fn().mockResolvedValue(page ?? createMockPage()),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

interface IMockBrowser {
  newContext: jest.Mock;
  close: jest.Mock;
}

/**
 * Creates a mock browser with newContext and close stubs.
 * @param context - optional mock context to return from newContext()
 * @returns a mock browser
 */
export function createMockBrowser(context?: IMockContext): IMockBrowser {
  const mockCtx = context ?? createMockContext();
  return {
    newContext: jest.fn().mockResolvedValue(mockCtx),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

/**
 * Creates mock scraper options with sensible defaults.
 * @param overrides - optional overrides for ScraperOptions fields
 * @returns scraper options for unit testing
 */
export function createMockScraperOptions(overrides: Partial<ScraperOptions> = {}): ScraperOptions {
  return {
    companyId: CompanyTypes.Hapoalim,
    startDate: new Date('2024-01-01'),
    ...overrides,
  } as ScraperOptions;
}
