import { jest } from '@jest/globals';

import { type IMockPage } from './MockPage.js';

export interface ILocatorOverrides {
  isVisible?: boolean;
  getAttribute?: string;
  count?: number;
  all?: object[];
  allLength?: number;
}

/**
 * Creates a base mock locator with self-referencing first/nth.
 * @param stubs - method stubs to attach to the locator.
 * @returns mock locator with first() and nth() returning self.
 */
export function createBaseMockLocator(stubs: Record<string, jest.Mock>): Record<string, jest.Mock> {
  const loc: Record<string, jest.Mock> = {
    first: jest.fn(),
    nth: jest.fn(),
    ...stubs,
  };
  loc.first.mockReturnValue(loc);
  loc.nth.mockReturnValue(loc);
  return loc;
}

/**
 * Creates a mock locator for Mizrahi page tests.
 * @param overrides - partial locator method overrides.
 * @returns mock locator with all standard stubs.
 */
export function buildMockLocator(overrides: ILocatorOverrides = {}): Record<string, jest.Mock> {
  return createBaseMockLocator({
    click: jest.fn().mockResolvedValue(undefined),
    waitFor: jest.fn().mockResolvedValue(undefined),
    isVisible: jest.fn().mockResolvedValue(overrides.isVisible ?? true),
    getAttribute: jest.fn().mockResolvedValue(overrides.getAttribute ?? 'ACC-12345'),
    count: jest.fn().mockResolvedValue(overrides.count ?? 1),
    all: jest.fn().mockResolvedValue(overrides.all ?? [{ click: jest.fn() }]),
    evaluate: jest.fn().mockResolvedValue(undefined),
    evaluateAll: jest.fn().mockResolvedValue([]),
  });
}

/**
 * Creates a mock frame locator that rejects waitFor.
 * @returns mock locator with rejected waitFor.
 */
export function mockFrameLocator(): Record<string, jest.Mock> {
  const loc: Record<string, jest.Mock> = {
    first: jest.fn(),
    waitFor: jest.fn().mockRejectedValue(new Error('not found')),
  };
  loc.first.mockReturnValue(loc);
  return loc;
}

/** Scraped transaction shape from Mizrahi API. */
export interface IMizrahiScrapedTxn {
  RecTypeSpecified: boolean;
  MC02PeulaTaaEZ: string;
  MC02SchumEZ: number;
  MC02AsmahtaMekoritEZ: string;
  MC02TnuaTeurEZ: string;
  IsTodayTransaction: boolean;
  MC02ErehTaaEZ: string;
  MC02ShowDetailsEZ?: string;
  MC02KodGoremEZ?: string;
  MC02SugTnuaKaspitEZ?: string;
  MC02AgidEZ?: string;
  MC02SeifMaralEZ?: string;
  MC02NoseMaralEZ?: string;
  TransactionNumber: string | number | null;
}

/**
 * Builds a scraped transaction with sensible defaults.
 * @param overrides - partial transaction fields to merge with defaults.
 * @returns complete scraped transaction object.
 */
export function scrapedTxn(overrides: Partial<IMizrahiScrapedTxn> = {}): IMizrahiScrapedTxn {
  return {
    RecTypeSpecified: true,
    MC02PeulaTaaEZ: '2025-06-15T10:00:00',
    MC02SchumEZ: -150,
    MC02AsmahtaMekoritEZ: '12345',
    MC02TnuaTeurEZ: 'העברה בנקאית',
    IsTodayTransaction: false,
    MC02ErehTaaEZ: '2025-06-16T00:00:00',
    MC02ShowDetailsEZ: '0',
    TransactionNumber: null,
    ...overrides,
  };
}

/**
 * Builds a mock API response with given rows and balance.
 * @param rows - array of scraped transactions for the response body.
 * @param balance - account balance string for the response body.
 * @returns mock API response object.
 */
export function mockApiResponse(rows: IMizrahiScrapedTxn[] = [], balance = '5000'): object {
  return {
    header: { success: true, messages: [] },
    body: {
      fields: { Yitra: balance },
      table: { rows },
    },
  };
}

/**
 * Builds a mock details response for extra transaction info.
 * @param fields - array of label-value pairs for the details response.
 * @returns mock details response object.
 */
export function mockDetailsResponse(fields: { Label: string; Value: string }[]): object {
  return {
    body: {
      fields: [[{ Records: [{ Fields: fields }] }]],
    },
  };
}

/**
 * Creates a mock locator with standard stubs. Delegates to buildMockLocator.
 * @param opts - optional overrides for locator methods.
 * @returns a mock locator object.
 */
function mockLocator(opts: ILocatorOverrides = {}): Record<string, jest.Mock> {
  const allItems = Array.from({ length: opts.allLength ?? 1 }, () => ({ click: jest.fn() }));
  return buildMockLocator({ ...opts, all: allItems });
}

/**
 * Creates a mock Mizrahi page with default request/selector stubs.
 * @param createMockPage - factory function to create a mock page with overrides.
 * @returns configured mock page for Mizrahi scraper tests.
 */
export function createMizrahiPage(
  createMockPage: (overrides: Partial<IMockPage>) => IMockPage,
): IMockPage {
  /**
   * Returns mock request post data as JSON string.
   * @returns serialized JSON body for mock requests.
   */
  const postDataFn = (): string => JSON.stringify({ table: {} });
  /**
   * Returns mock request headers with XSRF token.
   * @returns headers object with mizrahixsrftoken and content-type.
   */
  const headersFn = (): Record<string, string> => ({
    mizrahixsrftoken: 'xsrf-token',
    'content-type': 'application/json',
  });
  const mockRequest = {
    postData: postDataFn,
    headers: headersFn,
  };

  const defaultLoc = mockLocator();
  const getByTextLoc = mockLocator();

  return createMockPage({
    locator: jest.fn().mockReturnValue(defaultLoc),
    getByText: jest.fn().mockReturnValue(getByTextLoc),
    waitForRequest: jest.fn().mockResolvedValue(mockRequest),
  });
}
