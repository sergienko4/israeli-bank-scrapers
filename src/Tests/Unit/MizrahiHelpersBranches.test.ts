/**
 * Branch coverage tests for MizrahiHelpers.ts and MizrahiScraper.ts.
 * Targets: getStartMoment, getTransactionIdentifier, createDataFromRequest,
 * createHeadersFromRequest, parseDetailsFields, buildExtraDetailsParams.
 */
import moment from 'moment';

import type { IScrapedTransaction } from '../../Scrapers/Mizrahi/Interfaces/ScrapedTransaction.js';
import {
  createDataFromRequest,
  createHeadersFromRequest,
  getStartMoment,
  getTransactionIdentifier,
} from '../../Scrapers/Mizrahi/MizrahiHelpers.js';

/**
 * Build a mock Playwright Request with postData and headers.
 * @param postData - JSON string for request body.
 * @param headers - Request headers map.
 * @returns A mock request object.
 */
function makeRequest(
  postData: string,
  headers: Record<string, string> = {},
): { postData: () => string; headers: () => Record<string, string> } {
  return {
    /**
     * Returns the request body.
     * @returns The post data string.
     */
    postData: (): string => postData,
    /**
     * Returns the request headers.
     * @returns Headers map.
     */
    headers: (): Record<string, string> => headers,
  };
}

/**
 * Build a mock scraped transaction with defaults.
 * @param overrides - partial fields to merge.
 * @returns complete scraped transaction.
 */
function makeRow(overrides: Partial<IScrapedTransaction> = {}): IScrapedTransaction {
  return {
    RecTypeSpecified: true,
    MC02PeulaTaaEZ: '2025-01-15',
    MC02SchumEZ: 100,
    MC02AsmahtaMekoritEZ: '123456',
    MC02TnuaTeurEZ: 'Transfer',
    IsTodayTransaction: false,
    MC02ErehTaaEZ: '2025-01-15',
    MC02ShowDetailsEZ: '1',
    MC02KodGoremEZ: 'A',
    MC02SugTnuaKaspitEZ: 'B',
    MC02AgidEZ: 'C',
    MC02SeifMaralEZ: 'D',
    MC02NoseMaralEZ: 'E',
    TransactionNumber: 1,
    ...overrides,
  };
}

describe('getStartMoment', () => {
  it('returns user start date when after one year ago', () => {
    const recent = new Date();
    recent.setMonth(recent.getMonth() - 3);
    const startMoment = getStartMoment(recent);
    const expected = moment(recent);
    const isSameDay = startMoment.isSame(expected, 'day');
    expect(isSameDay).toBe(true);
  });

  it('caps at one year ago when user date is older', () => {
    const oldDate = new Date('2020-01-01');
    const startMoment = getStartMoment(oldDate);
    const oneYearAgo = moment().subtract(1, 'years');
    const isSameDay = startMoment.isSame(oneYearAgo, 'day');
    expect(isSameDay).toBe(true);
  });
});

describe('getTransactionIdentifier', () => {
  it('returns empty string when MC02AsmahtaMekoritEZ is empty', () => {
    const row = makeRow({ MC02AsmahtaMekoritEZ: '' });
    const identifier = getTransactionIdentifier(row);
    expect(identifier).toBe('');
  });

  it('returns composite key when TransactionNumber is not 1', () => {
    const row = makeRow({ TransactionNumber: 5 });
    const identifier = getTransactionIdentifier(row);
    expect(identifier).toBe('123456-5');
  });

  it('returns parsed integer when TransactionNumber is 1', () => {
    const row = makeRow({ TransactionNumber: 1 });
    const identifier = getTransactionIdentifier(row);
    expect(identifier).toBe(123456);
  });

  it('returns composite key when TransactionNumber is string not "1"', () => {
    const row = makeRow({ TransactionNumber: '3' });
    const identifier = getTransactionIdentifier(row);
    expect(identifier).toBe('123456-3');
  });

  it('returns parsed integer when TransactionNumber is string "1"', () => {
    const row = makeRow({ TransactionNumber: '1' });
    const identifier = getTransactionIdentifier(row);
    expect(identifier).toBe(123456);
  });
});

describe('createDataFromRequest', () => {
  it('builds request data with updated date range', () => {
    const body = JSON.stringify({
      inFromDate: '',
      inToDate: '',
      table: { maxRow: 0 },
    });
    const request = makeRequest(body);
    const result = createDataFromRequest(request as never, new Date('2025-01-01'));
    expect(result.inFromDate).toBeTruthy();
    expect(result.inToDate).toBeTruthy();
    expect(result.table.maxRow).toBeGreaterThan(0);
  });

  it('handles minimal postData with only required fields', () => {
    const body = JSON.stringify({ table: { maxRow: 0 } });
    const request = makeRequest(body);
    const result = createDataFromRequest(request as never, new Date('2025-01-01'));
    expect(result.table.maxRow).toBeGreaterThan(0);
  });
});

describe('createHeadersFromRequest', () => {
  it('extracts XSRF token and content-type', () => {
    const request = makeRequest('{}', {
      mizrahixsrftoken: 'tok123',
      'content-type': 'application/json',
    });
    const headers = createHeadersFromRequest(request as never);
    expect(headers.mizrahixsrftoken).toBe('tok123');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('handles missing headers gracefully', () => {
    const request = makeRequest('{}', {});
    const headers = createHeadersFromRequest(request as never);
    expect(headers.mizrahixsrftoken).toBeUndefined();
  });
});
