import { jest } from '@jest/globals';

import { createMockPage } from '../MockPage.js';

export interface IHapoalimScrapedTxn {
  serialNumber: number;
  activityDescription?: string;
  eventAmount: number;
  eventDate: string;
  valueDate: string;
  referenceNumber?: number;
  eventActivityTypeCode: number;
  currentBalance: number;
  pfmDetails: string;
  beneficiaryDetailsData?: Record<string, string | undefined>;
}

export const CREDS = { userCode: 'user123', password: 'pass456' };

export const MOCK_CONTEXT = {
  newPage: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};

export const MOCK_BROWSER = {
  newContext: jest.fn().mockResolvedValue(MOCK_CONTEXT),
  close: jest.fn().mockResolvedValue(undefined),
};

/**
 * Create a mock Hapoalim page with required evaluate and cookies mocks.
 * @returns Mocked page for Hapoalim.
 */
export function createHapoalimPage(): ReturnType<typeof createMockPage> {
  return createMockPage({
    evaluate: jest
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce('/api/v1')
      .mockResolvedValue(false),
    cookies: jest.fn().mockResolvedValue([{ name: 'XSRF-TOKEN', value: 'xsrf-token-value' }]),
  });
}

/**
 * Build a scraped transaction fixture for Hapoalim.
 * @param overrides - Partial fields to override.
 * @returns A complete Hapoalim scraped transaction.
 */
export function scrapedTxn(overrides: Partial<IHapoalimScrapedTxn> = {}): IHapoalimScrapedTxn {
  return {
    serialNumber: 42,
    activityDescription: '\u05E7\u05E0\u05D9\u05D4',
    eventAmount: 150.0,
    eventDate: '20240615',
    valueDate: '20240616',
    referenceNumber: 123456,
    eventActivityTypeCode: 2,
    currentBalance: 10000.0,
    pfmDetails: '/pfm/details?id=1',
    ...overrides,
  };
}
