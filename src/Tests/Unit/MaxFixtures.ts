import { jest } from '@jest/globals';

import type { IScrapedTransaction } from '../../Scrapers/Max/MaxScraper.js';
import { CREDS_USERNAME_PASSWORD } from '../TestConstants.js';

export type { IScrapedTransaction };

export const CREDS = CREDS_USERNAME_PASSWORD;

export const MOCK_CONTEXT = {
  newPage: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};

export const MOCK_BROWSER = {
  newContext: jest.fn().mockResolvedValue(MOCK_CONTEXT),
  close: jest.fn().mockResolvedValue(undefined),
};

/**
 * Creates a raw Max transaction with sensible defaults.
 * @param overrides - fields to override
 * @returns a scraped transaction
 */
export function rawTxn(overrides: Partial<IScrapedTransaction> = {}): IScrapedTransaction {
  return {
    shortCardNumber: '4580',
    paymentDate: '2024-06-15',
    purchaseDate: '2024-06-10',
    actualPaymentAmount: '100',
    paymentCurrency: 376,
    originalCurrency: 'ILS',
    originalAmount: 100,
    planName: 'רגילה',
    planTypeId: 5,
    comments: '',
    merchantName: 'סופר שופ',
    categoryId: 1,
    ...overrides,
  };
}

/**
 * Mocks the categories API call.
 * @param fetchGet - the fetch mock to configure
 * @returns the fetch mock
 */
export function mockCategories(fetchGet: jest.Mock): jest.Mock {
  fetchGet.mockResolvedValueOnce({
    result: [{ id: 1, name: 'מזון' }],
  });
  return fetchGet;
}

/**
 * Mocks a single month of transaction data.
 * @param fetchGet - the fetch mock to configure
 * @param txns - transactions to include
 * @returns the fetch mock
 */
export function mockTxnMonth(fetchGet: jest.Mock, txns: IScrapedTransaction[] = []): jest.Mock {
  fetchGet.mockResolvedValueOnce({
    result: { transactions: txns },
  });
  return fetchGet;
}
