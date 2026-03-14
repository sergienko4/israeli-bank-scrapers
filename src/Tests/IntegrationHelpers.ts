/**
 * Integration test helpers: browser scaffold + typed assertions.
 *
 * Import via dynamic `import()` AFTER mock registration:
 * ```ts
 * const { createBrowserScaffold, assertSuccess } = await import('../IntegrationHelpers.js');
 * ```
 */
import { jest } from '@jest/globals';

import type { ScraperErrorTypes } from '../Scrapers/Base/ErrorTypes.js';
import type { IScraperScrapingResult } from '../Scrapers/Base/Interface.js';
import type { ITransactionsAccount } from '../Transactions.js';

/** Browser scaffold with mock browser, context, page wiring. */
interface IBrowserScaffold {
  /** Mock browser with newContext(). */
  mockBrowser: { newContext: jest.Mock; close: jest.Mock };
  /** Mock context with newPage(). */
  mockContext: { newPage: jest.Mock; close: jest.Mock };
  /**
   * Wire a mock page into the scaffold.
   * @param page - mock page to return from newPage()
   * @returns true when wired
   */
  wirePage: (page: Record<string, jest.Mock>) => boolean;
}

/**
 * Create a browser scaffold wiring mockBrowser, mockContext, page.
 * @returns scaffold with mockBrowser, mockContext, wirePage
 */
export function createBrowserScaffold(): IBrowserScaffold {
  const mockContext = {
    newPage: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const mockBrowser = {
    newContext: jest.fn().mockResolvedValue(mockContext),
    close: jest.fn().mockResolvedValue(undefined),
  };
  /**
   * Wire a page into the context.
   * @param page - mock page
   * @returns true
   */
  const wirePage = (page: Record<string, jest.Mock>): boolean => {
    mockContext.newPage.mockResolvedValue(page);
    return true;
  };
  return { mockBrowser, mockContext, wirePage };
}

/**
 * Assert scrape succeeded and return typed accounts array.
 * @param result - scraper result
 * @param expectedCount - expected number of accounts
 * @returns typed accounts array for further assertions
 */
export function assertSuccess(
  result: IScraperScrapingResult,
  expectedCount: number,
): ITransactionsAccount[] {
  expect(result.success).toBe(true);
  expect(result.accounts).toBeDefined();
  const accounts = result.accounts ?? [];
  expect(accounts).toHaveLength(expectedCount);
  return accounts;
}

/**
 * Assert scrape failed with a specific error type.
 * @param result - scraper result
 * @param errorType - expected ScraperErrorTypes value
 * @returns true when assertions pass
 */
export function assertFailure(
  result: IScraperScrapingResult,
  errorType: ScraperErrorTypes,
): boolean {
  expect(result.success).toBe(false);
  expect(result.errorType).toBe(errorType);
  return true;
}

/**
 * Assert scrape succeeded but returned zero transactions.
 * @param result - scraper result
 * @returns true when assertions pass
 */
export function assertEmptyTxns(result: IScraperScrapingResult): boolean {
  expect(result.success).toBe(true);
  const accounts = result.accounts ?? [];
  const totalTxns = accounts.reduce((sum, acct) => sum + acct.txns.length, 0);
  expect(totalTxns).toBe(0);
  return true;
}
