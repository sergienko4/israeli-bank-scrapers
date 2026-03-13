import { jest } from '@jest/globals';
jest.unstable_mockModule('../../Common/Fetch.js', () => ({
  fetchGetWithinPage: jest.fn(),
}));

jest.unstable_mockModule('../../Common/Waiting.js', () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
  humanDelay: jest.fn().mockResolvedValue(undefined),
  runSerial: jest.fn(),
  waitUntil: jest.fn().mockResolvedValue(undefined),
  raceTimeout: jest.fn().mockResolvedValue(undefined),
  TimeoutError: class TimeoutError extends Error {},
  SECOND: 1000,
}));

jest.unstable_mockModule('../../Common/Debug.js', () => ({
  /**
   * Creates a mock debug logger.
   * @returns A mock debug logger object.
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
}));

const MOMENT_MOD = await import('moment');
const FETCH_MOD = await import('../../Common/Fetch.js');
const ISRACARD_FETCH_MOD = await import('../../Scrapers/BaseIsracardAmex/BaseIsracardAmexFetch.js');
const MOCK_PAGE_MOD = await import('../MockPage.js');

const SERVICES_URL = 'https://digital.example.co.il/ServerServices/services/ProxyService';

let page: ReturnType<typeof MOCK_PAGE_MOD.createMockPage>;

beforeEach(() => {
  jest.clearAllMocks();
  page = MOCK_PAGE_MOD.createMockPage();
});

describe('fetchAccounts', () => {
  it('returns mapped accounts when response is valid', async () => {
    (FETCH_MOD.fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({
      Header: { Status: '1' },
      DashboardMonthBean: {
        cardsCharges: [
          { cardIndex: '0', cardNumber: '1234-5678', billingDate: '15/06/2024' },
          { cardIndex: '1', cardNumber: '9876-5432', billingDate: '15/07/2024' },
        ],
      },
    });

    const startMoment = MOMENT_MOD.default('2024-06-01');
    const result = await ISRACARD_FETCH_MOD.fetchAccounts(page as never, SERVICES_URL, startMoment);

    expect(result).toHaveLength(2);
    expect(result[0].index).toBe(0);
    expect(result[0].accountNumber).toBe('1234-5678');
    expect(result[1].index).toBe(1);
    expect(result[1].accountNumber).toBe('9876-5432');
  });

  it('returns empty array when response is null', async () => {
    (FETCH_MOD.fetchGetWithinPage as jest.Mock).mockResolvedValueOnce(null);

    const startMoment = MOMENT_MOD.default('2024-06-01');
    const result = await ISRACARD_FETCH_MOD.fetchAccounts(page as never, SERVICES_URL, startMoment);
    expect(result).toEqual([]);
  });

  it('returns empty array when Header.Status is not 1', async () => {
    (FETCH_MOD.fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({ Header: { Status: '0' } });

    const startMoment = MOMENT_MOD.default('2024-06-01');
    const result = await ISRACARD_FETCH_MOD.fetchAccounts(page as never, SERVICES_URL, startMoment);
    expect(result).toEqual([]);
  });

  it('returns empty array when DashboardMonthBean is missing', async () => {
    (FETCH_MOD.fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({ Header: { Status: '1' } });

    const startMoment = MOMENT_MOD.default('2024-06-01');
    const result = await ISRACARD_FETCH_MOD.fetchAccounts(page as never, SERVICES_URL, startMoment);
    expect(result).toEqual([]);
  });

  it('returns empty array when cardsCharges is undefined', async () => {
    (FETCH_MOD.fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({
      Header: { Status: '1' },
      DashboardMonthBean: {},
    });

    const startMoment = MOMENT_MOD.default('2024-06-01');
    const result = await ISRACARD_FETCH_MOD.fetchAccounts(page as never, SERVICES_URL, startMoment);
    expect(result).toEqual([]);
  });

  it('calls fetchGetWithinPage with DashboardMonth reqName', async () => {
    (FETCH_MOD.fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({ Header: { Status: '0' } });

    const startMoment = MOMENT_MOD.default('2024-06-15');
    await ISRACARD_FETCH_MOD.fetchAccounts(page as never, SERVICES_URL, startMoment);

    const fetchMock = FETCH_MOD.fetchGetWithinPage as jest.Mock;
    const firstCallArgs = fetchMock.mock.calls[0] as [never, string];
    const calledUrl = firstCallArgs[1];
    expect(calledUrl).toContain('reqName=DashboardMonth');
    expect(calledUrl).toContain('billingDate=2024-06-15');
  });

  it('parses processedDate from billingDate as ISO string', async () => {
    (FETCH_MOD.fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({
      Header: { Status: '1' },
      DashboardMonthBean: {
        cardsCharges: [{ cardIndex: '0', cardNumber: '1234', billingDate: '15/06/2024' }],
      },
    });

    const startMoment = MOMENT_MOD.default('2024-06-15');
    const result = await ISRACARD_FETCH_MOD.fetchAccounts(page as never, SERVICES_URL, startMoment);
    expect(result[0].processedDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('fetchTxnData', () => {
  it('calls fetchGetWithinPage with CardsTransactionsList reqName', async () => {
    (FETCH_MOD.fetchGetWithinPage as jest.Mock).mockResolvedValueOnce(null);

    const startMoment = MOMENT_MOD.default('2024-06-01');
    await ISRACARD_FETCH_MOD.fetchTxnData(page as never, SERVICES_URL, startMoment);

    const fetchMock = FETCH_MOD.fetchGetWithinPage as jest.Mock;
    const firstCallArgs = fetchMock.mock.calls[0] as [never, string];
    const calledUrl = firstCallArgs[1];
    expect(calledUrl).toContain('reqName=CardsTransactionsList');
    expect(calledUrl).toContain('month=06');
    expect(calledUrl).toContain('year=2024');
    expect(calledUrl).toContain('requiredDate=N');
  });

  it('returns the raw data from fetchGetWithinPage', async () => {
    const mockData = {
      Header: { Status: '1' },
      CardsTransactionsListBean: {},
    };
    (FETCH_MOD.fetchGetWithinPage as jest.Mock).mockResolvedValueOnce(mockData);

    const startMoment = MOMENT_MOD.default('2024-06-01');
    const result = await ISRACARD_FETCH_MOD.fetchTxnData(page as never, SERVICES_URL, startMoment);
    expect(result).toBe(mockData);
  });

  it('returns null when fetchGetWithinPage returns null', async () => {
    (FETCH_MOD.fetchGetWithinPage as jest.Mock).mockResolvedValueOnce(null);

    const startMoment = MOMENT_MOD.default('2024-06-01');
    const result = await ISRACARD_FETCH_MOD.fetchTxnData(page as never, SERVICES_URL, startMoment);
    expect(result).toBeNull();
  });

  it('pads single-digit month with leading zero', async () => {
    (FETCH_MOD.fetchGetWithinPage as jest.Mock).mockResolvedValueOnce(null);

    const startMoment = MOMENT_MOD.default('2024-03-01');
    await ISRACARD_FETCH_MOD.fetchTxnData(page as never, SERVICES_URL, startMoment);

    const fetchMock = FETCH_MOD.fetchGetWithinPage as jest.Mock;
    const firstCallArgs = fetchMock.mock.calls[0] as [never, string];
    const calledUrl = firstCallArgs[1];
    expect(calledUrl).toContain('month=03');
  });

  it('does not pad two-digit month', async () => {
    (FETCH_MOD.fetchGetWithinPage as jest.Mock).mockResolvedValueOnce(null);

    const startMoment = MOMENT_MOD.default('2024-11-01');
    await ISRACARD_FETCH_MOD.fetchTxnData(page as never, SERVICES_URL, startMoment);

    const fetchMock = FETCH_MOD.fetchGetWithinPage as jest.Mock;
    const firstCallArgs = fetchMock.mock.calls[0] as [never, string];
    const calledUrl = firstCallArgs[1];
    expect(calledUrl).toContain('month=11');
  });
});
