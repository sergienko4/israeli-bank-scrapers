/**
 * Branch coverage tests for VisaCalFetch.ts.
 * Targets: fetchMonthData null/error responses, fetchPendingData status branches,
 * fetchCards null/mapped responses, fetchFrames null response,
 * buildApiHeaders field values, buildMonthRange length.
 */
import { jest } from '@jest/globals';

import {
  createBrowserMock,
  createCamoufoxMock,
  createDebugMock,
  createElementsMock,
  createFetchMock,
  createNavigationMock,
  createStorageMock,
  createTransactionsMock,
  createWaitingMock,
} from '../MockModuleFactories.js';

const FETCH_MOCK = createFetchMock();
const MOCK_FETCH_POST = FETCH_MOCK.fetchPostWithinPage;

jest.unstable_mockModule('../../Common/CamoufoxLauncher.js', createCamoufoxMock);
jest.unstable_mockModule('../../Common/Fetch.js', () => FETCH_MOCK);
jest.unstable_mockModule('../../Common/Browser.js', createBrowserMock);
jest.unstable_mockModule('../../Common/Navigation.js', () =>
  createNavigationMock('https://test.cal'),
);
jest.unstable_mockModule('../../Common/ElementsInteractions.js', createElementsMock);
jest.unstable_mockModule('../../Common/Storage.js', createStorageMock);
jest.unstable_mockModule('../../Common/Waiting.js', createWaitingMock);
jest.unstable_mockModule('../../Common/Transactions.js', createTransactionsMock);
jest.unstable_mockModule('../../Common/Debug.js', createDebugMock);

const VISA_CAL_FETCH = await import('../../Scrapers/VisaCal/VisaCalFetch.js');

/**
 * Creates a mock page for VisaCal fetch tests.
 * @returns A mock page object.
 */
function makePage(): Record<string, jest.Mock> {
  return {
    /**
     * Evaluate mock.
     * @returns Empty string.
     */
    evaluate: jest.fn().mockResolvedValue(''),
  };
}

/** Standard card fixture. */
const CARD = { cardUniqueId: 'card-123', last4Digits: '4567' };

/** Error cases for fetchMonthData: [label, response, expectedError]. */
const FETCH_MONTH_ERROR_CASES = [
  ['null response', null, 'null response'],
  [
    'validation failure (statusCode 2)',
    { statusCode: 2, title: 'Card blocked' },
    'failed to fetch transactions for card 4567',
  ],
] as const;

describe('fetchMonthData — error branches', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(FETCH_MONTH_ERROR_CASES)('throws for %s', async (_label, response, expectedError) => {
    MOCK_FETCH_POST.mockResolvedValue(response);
    const moment = (await import('moment')).default;
    const month = moment('2024-06').clone();

    const fetchPromise = VISA_CAL_FETCH.fetchMonthData({
      page: makePage() as never,
      card: CARD,
      month,
      hdrs: {},
    });
    await expect(fetchPromise).rejects.toThrow(expectedError);
  });

  it('returns transaction details for valid response', async () => {
    MOCK_FETCH_POST.mockResolvedValue({ statusCode: 1, result: { transactions: [] } });
    const moment = (await import('moment')).default;
    const month = moment('2024-06').clone();

    const result = await VISA_CAL_FETCH.fetchMonthData({
      page: makePage() as never,
      card: CARD,
      month,
      hdrs: {},
    });
    expect(result.result).toBeDefined();
  });
});

describe('fetchPendingData — branches', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws when fetch returns null', async () => {
    MOCK_FETCH_POST.mockResolvedValue(null);
    const page = makePage();
    const fetchPromise = VISA_CAL_FETCH.fetchPendingData(page as never, CARD, {});
    await expect(fetchPromise).rejects.toThrow('null response');
  });

  it('handles non-critical failure (statusCode not 1 or 96)', async () => {
    MOCK_FETCH_POST.mockResolvedValue({ statusCode: 99, title: 'Pending unavailable' });
    const page = makePage();
    const result = await VISA_CAL_FETCH.fetchPendingData(page as never, CARD, {});
    expect(result.statusCode).toBe(99);
  });

  const successStatusCodes = [
    [1, 'primary success'],
    [96, 'alternate success'],
  ] as const;

  it.each(successStatusCodes)(
    'returns pending details for statusCode %i (%s)',
    async statusCode => {
      const resp = { statusCode, result: { pendingTransactions: [] } };
      MOCK_FETCH_POST.mockResolvedValue(resp);
      const page = makePage();
      const result = await VISA_CAL_FETCH.fetchPendingData(page as never, CARD, {});
      expect(result.statusCode).toBe(statusCode);
    },
  );
});

describe('fetchCards — branches', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws when init returns null', async () => {
    MOCK_FETCH_POST.mockResolvedValue(null);
    const page = makePage();
    const fetchPromise = VISA_CAL_FETCH.fetchCards(page as never, {});
    await expect(fetchPromise).rejects.toThrow('null init response');
  });

  it('returns mapped card info from init response', async () => {
    MOCK_FETCH_POST.mockResolvedValue({
      result: { cards: [{ cardUniqueId: 'c1', last4Digits: '1234', extra: 'ignored' }] },
    });
    const page = makePage();
    const cards = await VISA_CAL_FETCH.fetchCards(page as never, {});
    expect(cards).toEqual([{ cardUniqueId: 'c1', last4Digits: '1234' }]);
  });
});

describe('fetchFrames — branches', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws when frames response is null', async () => {
    MOCK_FETCH_POST.mockResolvedValue(null);
    const page = makePage();
    const fetchPromise = VISA_CAL_FETCH.fetchFrames(page as never, {}, [CARD]);
    await expect(fetchPromise).rejects.toThrow('null response');
  });
});

describe('buildApiHeaders', () => {
  it('returns headers with auth, site id, and default headers', () => {
    const hdrs = VISA_CAL_FETCH.buildApiHeaders('Bearer token123', 'site-42');
    expect(hdrs.authorization).toBe('Bearer token123');
    expect(hdrs['X-Site-Id']).toBe('site-42');
    expect(hdrs['Content-Type']).toBe('application/json');
    expect(hdrs).toHaveProperty('User-Agent');
    expect(hdrs).toHaveProperty('Accept-Language');
    expect(hdrs).toHaveProperty('Origin');
    expect(hdrs).toHaveProperty('Referer');
  });
});

describe('buildMonthRange', () => {
  it('builds correct number of months', async () => {
    const moment = (await import('moment')).default;
    const now = moment().clone();
    const start = now.clone().subtract(2, 'months');
    const range = VISA_CAL_FETCH.buildMonthRange(start, 0);
    expect(range).toHaveLength(3);
  });
});
