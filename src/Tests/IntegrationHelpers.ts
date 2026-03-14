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

/** Generic account mock reusable across banks that use account number + branch format. */
export interface ITestAccountMock {
  bankNumber: string;
  branchNumber: string;
  accountNumber: string;
  accountClosingReasonCode: number;
}

/** Mock browser context shape. */
export interface IMockContext {
  newPage: jest.Mock;
  close: jest.Mock;
}

/** Mock browser shape. */
export interface IMockBrowser {
  newContext: jest.Mock;
  close: jest.Mock;
}

/**
 * Create a mock browser context with newPage() and close().
 * @returns mock context object
 */
export function createMockContext(): IMockContext {
  return {
    newPage: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

/**
 * Create a mock browser wired to a given context.
 * @param context - mock context to return from newContext()
 * @returns mock browser object
 */
export function createMockBrowser(context: IMockContext): IMockBrowser {
  return {
    newContext: jest.fn().mockResolvedValue(context),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

/** Browser scaffold return type. */
interface IBrowserScaffold {
  mockBrowser: IMockBrowser;
  mockContext: IMockContext;
  wirePage: (pg: Record<string, jest.Mock>) => boolean;
}

/**
 * Create a browser scaffold wiring mockBrowser, mockContext, page.
 * @returns scaffold with mockBrowser, mockContext, wirePage
 */
export function createBrowserScaffold(): IBrowserScaffold {
  const mockContext = createMockContext();
  const mockBrowser = createMockBrowser(mockContext);
  /**
   * Wire a page mock into the context.
   * @param pg - mock page to wire
   * @returns true when wired
   */
  const wirePage = (pg: Record<string, jest.Mock>): boolean => {
    mockContext.newPage.mockResolvedValue(pg);
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
  expect(result.accounts).toBeDefined();
  const accounts = result.accounts ?? [];
  const totalTxns = accounts.reduce((sum, acct) => sum + acct.txns.length, 0);
  expect(totalTxns).toBe(0);
  return true;
}
