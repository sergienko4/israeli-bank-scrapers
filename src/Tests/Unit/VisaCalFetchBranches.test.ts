import { jest } from '@jest/globals';

const MOCK_FETCH_POST = jest.fn();

jest.unstable_mockModule(
  '../../Common/CamoufoxLauncher.js',
  /**
   * Mocked CamoufoxLauncher module.
   * @returns Mocked CamoufoxLauncher.
   */
  () => ({ launchCamoufox: jest.fn() }),
);

jest.unstable_mockModule(
  '../../Common/Fetch.js',
  /**
   * Mocked Fetch module.
   * @returns Mocked Fetch.
   */
  () => ({
    fetchPostWithinPage: MOCK_FETCH_POST,
    fetchGetWithinPage: jest.fn(),
  }),
);

jest.unstable_mockModule(
  '../../Common/Browser.js',
  /**
   * Mocked Browser module.
   * @returns Mocked Browser.
   */
  () => ({ buildContextOptions: jest.fn().mockReturnValue({}) }),
);

jest.unstable_mockModule(
  '../../Common/Navigation.js',
  /**
   * Mocked Navigation module.
   * @returns Mocked Navigation.
   */
  () => ({
    getCurrentUrl: jest.fn().mockResolvedValue('https://test.cal'),
    waitForNavigation: jest.fn().mockResolvedValue(undefined),
    waitForNavigationAndDomLoad: jest.fn().mockResolvedValue(undefined),
    waitForRedirect: jest.fn().mockResolvedValue(undefined),
    waitForUrl: jest.fn().mockResolvedValue(undefined),
  }),
);

jest.unstable_mockModule(
  '../../Common/ElementsInteractions.js',
  /**
   * Mocked ElementsInteractions module.
   * @returns Mocked ElementsInteractions.
   */
  () => ({
    clickButton: jest.fn().mockResolvedValue(undefined),
    fillInput: jest.fn().mockResolvedValue(undefined),
    waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
    elementPresentOnPage: jest.fn().mockResolvedValue(false),
    waitUntilIframeFound: jest.fn().mockResolvedValue(undefined),
    pageEval: jest.fn().mockResolvedValue(''),
  }),
);

jest.unstable_mockModule(
  '../../Common/Storage.js',
  /**
   * Mocked Storage module.
   * @returns Mocked Storage.
   */
  () => ({ getFromSessionStorage: jest.fn() }),
);

jest.unstable_mockModule(
  '../../Common/Waiting.js',
  /**
   * Mocked Waiting module.
   * @returns Mocked Waiting.
   */
  () => ({
    waitUntil: jest.fn().mockResolvedValue(undefined),
    sleep: jest.fn().mockResolvedValue(undefined),
    humanDelay: jest.fn().mockResolvedValue(undefined),
    runSerial: jest.fn().mockResolvedValue([]),
    TimeoutError: class TimeoutError extends Error {},
    SECOND: 1000,
    raceTimeout: jest.fn().mockResolvedValue(undefined),
  }),
);

jest.unstable_mockModule(
  '../../Common/Transactions.js',
  /**
   * Mocked Transactions module.
   * @returns Mocked Transactions.
   */
  () => ({
    filterOldTransactions: jest.fn(<T>(txns: T[]): T[] => txns),
    getRawTransaction: jest.fn(),
  }),
);

jest.unstable_mockModule(
  '../../Common/Debug.js',
  /**
   * Mocked Debug module.
   * @returns Mocked Debug.
   */
  () => ({
    /**
     * Creates a mock debug logger.
     * @returns Mock logger with all levels.
     */
    getDebug: (): Record<string, jest.Mock> => ({
      trace: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
    /**
     * Passthrough mock for bank context.
     * @param _b - Bank name (unused).
     * @param fn - Function to execute.
     * @returns fn result.
     */
    runWithBankContext: <T>(_b: string, fn: () => T): T => fn(),
  }),
);

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

describe('fetchMonthData — error branches', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws when fetch returns null', async () => {
    MOCK_FETCH_POST.mockResolvedValue(null);
    const moment = (await import('moment')).default;
    const page = makePage();
    const month = moment('2024-06');

    const fetchPromise = VISA_CAL_FETCH.fetchMonthData({
      page: page as never,
      card: CARD,
      month,
      hdrs: {},
    });
    await expect(fetchPromise).rejects.toThrow('null response');
  });

  it('throws when statusCode is not 1 (validation failure)', async () => {
    MOCK_FETCH_POST.mockResolvedValue({ statusCode: 2, title: 'Card blocked' });
    const moment = (await import('moment')).default;
    const page = makePage();
    const month = moment('2024-06');

    const fetchPromise = VISA_CAL_FETCH.fetchMonthData({
      page: page as never,
      card: CARD,
      month,
      hdrs: {},
    });
    await expect(fetchPromise).rejects.toThrow('failed to fetch transactions for card 4567');
  });

  it('returns transaction details for valid response', async () => {
    const validResponse = { statusCode: 1, result: { transactions: [] } };
    MOCK_FETCH_POST.mockResolvedValue(validResponse);
    const moment = (await import('moment')).default;
    const page = makePage();
    const month = moment('2024-06');

    const result = await VISA_CAL_FETCH.fetchMonthData({
      page: page as never,
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

  it('returns pending details for valid response', async () => {
    const validResp = { statusCode: 1, result: { pendingTransactions: [] } };
    MOCK_FETCH_POST.mockResolvedValue(validResp);
    const page = makePage();
    const result = await VISA_CAL_FETCH.fetchPendingData(page as never, CARD, {});
    expect(result.statusCode).toBe(1);
  });

  it('returns response with statusCode 96 (alternate success)', async () => {
    const resp = { statusCode: 96, result: { pendingTransactions: [] } };
    MOCK_FETCH_POST.mockResolvedValue(resp);
    const page = makePage();
    const result = await VISA_CAL_FETCH.fetchPendingData(page as never, CARD, {});
    expect(result.statusCode).toBe(96);
  });
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
  it('returns headers with auth and site id', () => {
    const hdrs = VISA_CAL_FETCH.buildApiHeaders('Bearer token123', 'site-42');
    expect(hdrs.authorization).toBe('Bearer token123');
    expect(hdrs['X-Site-Id']).toBe('site-42');
    expect(hdrs['Content-Type']).toBe('application/json');
  });
});

describe('buildMonthRange', () => {
  it('builds correct number of months', async () => {
    const moment = (await import('moment')).default;
    const now = moment();
    const start = now.subtract(2, 'months');
    const range = VISA_CAL_FETCH.buildMonthRange(start, 0);
    expect(range.length).toBeGreaterThanOrEqual(2);
  });
});
