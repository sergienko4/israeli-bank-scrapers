import { jest } from '@jest/globals';

import { SHEKEL_CURRENCY } from '../../Constants.js';
import type { IScrapedTransaction } from '../../Scrapers/Max/MaxScraper.js';

/** Default values for a raw Max transaction used across Max test files. */
export const RAW_TXN_DEFAULTS: IScrapedTransaction = {
  shortCardNumber: '4580',
  paymentDate: '2024-06-15',
  purchaseDate: '2024-06-10',
  actualPaymentAmount: '100',
  paymentCurrency: 376,
  originalCurrency: SHEKEL_CURRENCY,
  originalAmount: 100,
  planName: 'רגילה',
  planTypeId: 5,
  comments: '',
  merchantName: 'סופר שופ',
  categoryId: 1,
};

/**
 * Creates a raw Max transaction with sensible defaults.
 * @param overrides - fields to override
 * @returns a scraped transaction
 */
export function rawTxn(overrides: Partial<IScrapedTransaction> = {}): IScrapedTransaction {
  return { ...RAW_TXN_DEFAULTS, ...overrides };
}

/**
 * Create a self-referencing error locator for Max login error tests.
 * @returns A mock locator with first() returning self and isVisible returning true.
 */
export function createErrorLocator(): Record<string, jest.Mock> {
  const loc: Record<string, jest.Mock> = {
    first: jest.fn(),
    isVisible: jest.fn().mockResolvedValue(true),
    waitFor: jest.fn().mockResolvedValue(undefined),
    click: jest.fn().mockResolvedValue(undefined),
  };
  loc.first.mockReturnValue(loc);
  return loc;
}
