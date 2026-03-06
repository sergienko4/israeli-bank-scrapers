import moment from 'moment';

import { fetchGetWithinPage } from '../../Common/Fetch';
import { fetchAccounts, fetchTxnData } from '../../Scrapers/BaseIsracardAmex/BaseIsracardAmexFetch';
import { createMockPage } from '../MockPage';

jest.mock('../../Common/Fetch', () => ({
  fetchGetWithinPage: jest.fn(),
}));

jest.mock('../../Common/Waiting', () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
  humanDelay: jest.fn().mockResolvedValue(undefined),
  runSerial: jest.fn(),
  TimeoutError: class TimeoutError extends Error {},
  SECOND: 1000,
}));

jest.mock('../../Common/Debug', () => ({
  /**
   * Returns a set of jest mock functions as a debug logger stub.
   *
   * @returns a mock debug logger with debug, info, warn, and error functions
   */
  getDebug: (): Record<string, jest.Mock> => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

const SERVICES_URL = 'https://digital.example.co.il/ServerServices/services/ProxyService';
/** Billing moment used as the startDate for fetchAccounts/fetchTxnData calls in tests. */
const JUN_2024 = moment('2024-06-01');
/** March billing moment for testing single-digit month padding. */
const MAR_2024 = moment('2024-03-01');
/** November billing moment for testing two-digit month. */
const NOV_2024 = moment('2024-11-01');
/** June 15 moment for testing processedDate formatting. */
const JUN_15_2024 = moment('2024-06-15');

let page: ReturnType<typeof createMockPage>;

beforeEach(() => {
  jest.clearAllMocks();
  page = createMockPage();
});

describe('fetchAccounts', () => {
  it('returns mapped accounts when response is valid', async () => {
    (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({
      Header: { Status: '1' },
      DashboardMonthBean: {
        cardsCharges: [
          { cardIndex: '0', cardNumber: '1234-5678', billingDate: '15/06/2024' },
          { cardIndex: '1', cardNumber: '9876-5432', billingDate: '15/07/2024' },
        ],
      },
    });

    const result = await fetchAccounts(page as never, SERVICES_URL, JUN_2024);

    expect(result).toHaveLength(2);
    expect(result[0].index).toBe(0);
    expect(result[0].accountNumber).toBe('1234-5678');
    expect(result[1].index).toBe(1);
    expect(result[1].accountNumber).toBe('9876-5432');
  });

  it('returns empty array when response is null', async () => {
    (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce(null);

    const result = await fetchAccounts(page as never, SERVICES_URL, JUN_2024);
    expect(result).toEqual([]);
  });

  it('returns empty array when Header.Status is not 1', async () => {
    (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({ Header: { Status: '0' } });

    const result = await fetchAccounts(page as never, SERVICES_URL, JUN_2024);
    expect(result).toEqual([]);
  });

  it('returns empty array when DashboardMonthBean is missing', async () => {
    (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({ Header: { Status: '1' } });

    const result = await fetchAccounts(page as never, SERVICES_URL, JUN_2024);
    expect(result).toEqual([]);
  });

  it('returns empty array when cardsCharges is undefined', async () => {
    (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({
      Header: { Status: '1' },
      DashboardMonthBean: {},
    });

    const result = await fetchAccounts(page as never, SERVICES_URL, JUN_2024);
    expect(result).toEqual([]);
  });

  it('calls fetchGetWithinPage with DashboardMonth reqName', async () => {
    (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce(null);

    await fetchAccounts(page as never, SERVICES_URL, JUN_15_2024);

    const calledUrl: string = (
      (fetchGetWithinPage as jest.Mock).mock.calls[0] as [unknown, string]
    )[1];
    expect(calledUrl).toContain('reqName=DashboardMonth');
    expect(calledUrl).toContain('billingDate=2024-06-15');
  });

  it('parses processedDate from billingDate as ISO string', async () => {
    (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({
      Header: { Status: '1' },
      DashboardMonthBean: {
        cardsCharges: [{ cardIndex: '0', cardNumber: '1234', billingDate: '15/06/2024' }],
      },
    });

    const result = await fetchAccounts(page as never, SERVICES_URL, JUN_15_2024);
    expect(result[0].processedDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('fetchTxnData', () => {
  it('calls fetchGetWithinPage with CardsTransactionsList reqName', async () => {
    (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce(null);

    await fetchTxnData(page as never, SERVICES_URL, JUN_2024);

    const calledUrl: string = (
      (fetchGetWithinPage as jest.Mock).mock.calls[0] as [unknown, string]
    )[1];
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
    (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce(mockData);

    const result = await fetchTxnData(page as never, SERVICES_URL, JUN_2024);
    expect(result).toBe(mockData);
  });

  it('returns null when fetchGetWithinPage returns null', async () => {
    (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce(null);

    const result = await fetchTxnData(page as never, SERVICES_URL, JUN_2024);
    expect(result).toBeNull();
  });

  it('pads single-digit month with leading zero', async () => {
    (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce(null);

    await fetchTxnData(page as never, SERVICES_URL, MAR_2024);

    const calledUrl: string = (
      (fetchGetWithinPage as jest.Mock).mock.calls[0] as [unknown, string]
    )[1];
    expect(calledUrl).toContain('month=03');
  });

  it('does not pad two-digit month', async () => {
    (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce(null);

    await fetchTxnData(page as never, SERVICES_URL, NOV_2024);

    const calledUrl: string = (
      (fetchGetWithinPage as jest.Mock).mock.calls[0] as [unknown, string]
    )[1];
    expect(calledUrl).toContain('month=11');
  });
});
