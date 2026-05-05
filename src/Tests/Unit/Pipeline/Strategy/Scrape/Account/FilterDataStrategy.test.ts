/**
 * Unit tests for Strategy/Scrape/Account/FilterDataStrategy.
 */

import {
  isFilterDataUrl,
  scrapeViaFilterData,
} from '../../../../../../Scrapers/Pipeline/Strategy/Scrape/Account/FilterDataStrategy.js';
import type { IAccountFetchCtx } from '../../../../../../Scrapers/Pipeline/Strategy/Scrape/ScrapeTypes.js';
import { isOk } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeApi,
  makeEndpoint,
  makeNetwork,
  stubFetchGetFail,
  stubFetchGetOk,
} from '../../StrategyTestHelpers.js';

describe('isFilterDataUrl', () => {
  it('returns true when URL has filterData query param', () => {
    const url = 'https://max.example/api/txn?filterData=%7B%22foo%22%3A1%7D';
    const isFilterDataUrlResult1 = isFilterDataUrl(url);
    expect(isFilterDataUrlResult1).toBe(true);
  });

  it('returns true when URL path contains filterData substring', () => {
    const isFilterDataUrlResult2 = isFilterDataUrl('https://x/filterdata/endpoint');
    expect(isFilterDataUrlResult2).toBe(true);
  });

  it('returns false for URL without filterData anywhere', () => {
    const isFilterDataUrlResult3 = isFilterDataUrl('https://bank.example/api/transactions?q=1');
    expect(isFilterDataUrlResult3).toBe(false);
  });

  it('returns false for empty string', () => {
    const isFilterDataUrlResult4 = isFilterDataUrl('');
    expect(isFilterDataUrlResult4).toBe(false);
  });

  it('returns true for malformed URLs when filterData substring present', () => {
    const isFilterDataUrlResult5 = isFilterDataUrl('not-a-valid-url-but-has-filterdata');
    expect(isFilterDataUrlResult5).toBe(true);
  });

  it('returns false for malformed URLs without filterData substring', () => {
    const isFilterDataUrlResult6 = isFilterDataUrl('garbage string here');
    expect(isFilterDataUrlResult6).toBe(false);
  });
});

describe('scrapeViaFilterData', () => {
  it('succeeds with buffered + fresh GET mix', async () => {
    const buffered = {
      result: {
        transactions: [
          {
            shortCardNumber: '1234',
            originalAmount: -50,
            description: 'buffered',
            fullPurchaseDate: '2026-01-10T00:00:00',
          },
        ],
      },
    };
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverTransactionsEndpoint: () =>
        makeEndpoint({
          url: 'https://max.example/api?filterData=xyz',
          method: 'GET',
          responseBody: buffered,
        }),
    });
    const fc: IAccountFetchCtx = {
      api: makeApi({ fetchGet: stubFetchGetOk(buffered) }),
      network,
      startDate: '20260101',
    };
    const result = await scrapeViaFilterData(fc, 'acc-1', 'https://max.example/api');
    const isOkResult7 = isOk(result);
    expect(isOkResult7).toBe(true);
  });

  it('succeeds with empty buffered + GET failures', async () => {
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverTransactionsEndpoint: () =>
        makeEndpoint({
          url: 'https://max.example/api?filterData=xyz',
          method: 'GET',
          responseBody: undefined,
        }),
    });
    const fc: IAccountFetchCtx = {
      api: makeApi({ fetchGet: stubFetchGetFail() }),
      network,
      startDate: '20260101',
    };
    const result = await scrapeViaFilterData(fc, 'acc-1', 'https://max.example/api');
    const isOkResult8 = isOk(result);
    expect(isOkResult8).toBe(true);
  });

  it('succeeds when no buffered endpoint at all', async () => {
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverTransactionsEndpoint: () => false,
    });
    const fc: IAccountFetchCtx = {
      api: makeApi({ fetchGet: stubFetchGetOk({}) }),
      network,
      startDate: '20260101',
    };
    const result = await scrapeViaFilterData(fc, 'acc-1', 'https://max.example/api');
    const isOkResult9 = isOk(result);
    expect(isOkResult9).toBe(true);
  });

  it('handles buffered body without result wrapper (displayId branch 98)', async () => {
    const buffered = {
      // No `result` field — extractDisplayIdFromRaw hits "if (!result)" branch
      transactions: [],
    };
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverTransactionsEndpoint: () =>
        makeEndpoint({
          url: 'https://max.example/api?filterData=xyz',
          method: 'GET',
          responseBody: buffered,
        }),
    });
    const fc: IAccountFetchCtx = {
      api: makeApi({ fetchGet: stubFetchGetOk({}) }),
      network,
      startDate: '20260101',
    };
    const result = await scrapeViaFilterData(fc, 'acc-1', 'https://max.example/api');
    const isOkResult10 = isOk(result);
    expect(isOkResult10).toBe(true);
  });

  it('handles buffered body with empty transactions array (displayId branch 100)', async () => {
    const buffered = {
      result: {
        transactions: [],
      },
    };
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverTransactionsEndpoint: () =>
        makeEndpoint({
          url: 'https://max.example/api?filterData=xyz',
          method: 'GET',
          responseBody: buffered,
        }),
    });
    const fc: IAccountFetchCtx = {
      api: makeApi({ fetchGet: stubFetchGetOk(buffered) }),
      network,
      startDate: '20260101',
    };
    const result = await scrapeViaFilterData(fc, 'acc-1', 'https://max.example/api');
    const isOkResult11 = isOk(result);
    expect(isOkResult11).toBe(true);
  });

  it('handles buffered body with transactions that lack shortCardNumber (displayId branch 103)', async () => {
    const buffered = {
      result: {
        transactions: [
          {
            // no shortCardNumber → findFieldValue returns false → line 103 branch
            originalAmount: -50,
            description: 'no-card-id',
            fullPurchaseDate: '2026-01-10T00:00:00',
          },
        ],
      },
    };
    const network = makeNetwork({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      discoverTransactionsEndpoint: () =>
        makeEndpoint({
          url: 'https://max.example/api?filterData=xyz',
          method: 'GET',
          responseBody: buffered,
        }),
    });
    const fc: IAccountFetchCtx = {
      api: makeApi({ fetchGet: stubFetchGetOk(buffered) }),
      network,
      startDate: '20260101',
    };
    const result = await scrapeViaFilterData(fc, 'acc-1', 'https://max.example/api');
    const isOkResult12 = isOk(result);
    expect(isOkResult12).toBe(true);
  });
});
