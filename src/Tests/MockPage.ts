import { jest } from '@jest/globals';
import { type Page } from 'playwright-core';

import { CompanyTypes } from '../Definitions.js';
import { type ScraperOptions } from '../Scrapers/Base/Interface.js';

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
  getByLabel: jest.Mock;
  getByRole: jest.Mock;
  cookies?: jest.Mock;
  [key: string]: jest.Mock | undefined;
}

type MockOverrides = Partial<IMockPage>;

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
    locator: jest.fn().mockReturnValue({
      first: jest.fn().mockReturnValue({
        fill: jest.fn().mockResolvedValue(undefined),
        click: jest.fn().mockResolvedValue(undefined),
        isVisible: jest.fn().mockResolvedValue(true),
        waitFor: jest.fn().mockResolvedValue(undefined),
        count: jest.fn().mockResolvedValue(1),
        evaluate: jest.fn().mockResolvedValue(undefined),
        getAttribute: jest.fn().mockResolvedValue(null),
        innerText: jest.fn().mockResolvedValue(''),
      }),
      count: jest.fn().mockResolvedValue(0),
      evaluateAll: jest.fn().mockResolvedValue([]),
      allInnerTexts: jest.fn().mockResolvedValue([]),
      all: jest.fn().mockResolvedValue([]),
    }),
    getByText: jest.fn().mockImplementation(() => {
      const loc = {
        first: jest.fn(),
        isVisible: jest.fn().mockResolvedValue(false),
        waitFor: jest.fn().mockResolvedValue(undefined),
        click: jest.fn().mockResolvedValue(undefined),
      };
      loc.first.mockReturnValue(loc);
      return loc;
    }),
    getByLabel: jest.fn().mockImplementation(() => {
      const loc = {
        first: jest.fn(),
        isVisible: jest.fn().mockResolvedValue(false),
        waitFor: jest.fn().mockResolvedValue(undefined),
        fill: jest.fn().mockResolvedValue(undefined),
        click: jest.fn().mockResolvedValue(undefined),
      };
      loc.first.mockReturnValue(loc);
      return loc;
    }),
    getByRole: jest.fn().mockImplementation(() => {
      const loc = {
        first: jest.fn(),
        isVisible: jest.fn().mockResolvedValue(false),
        waitFor: jest.fn().mockResolvedValue(undefined),
        click: jest.fn().mockResolvedValue(undefined),
      };
      loc.first.mockReturnValue(loc);
      return loc;
    }),
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
