import { faker } from '@faker-js/faker';
import moment from 'moment';

import { buildContextOptions } from '../../Common/Browser';
import { launchWithEngine } from '../../Common/BrowserEngine';
import { fetchGetWithinPage, fetchPostWithinPage } from '../../Common/Fetch';
import { ScraperErrorTypes } from '../../Scrapers/Base/Errors';
import { createMockPage } from '../MockPage';
import TestAmexScraper from './BaseIsracardAmexTestHelpers';

jest.mock('../../Common/BrowserEngine', () => ({
  launchWithEngine: jest.fn(),
  BrowserEngineType: {
    PlaywrightStealth: 'playwright-stealth',
    Rebrowser: 'rebrowser',
    Patchright: 'patchright',
  },
}));
jest.mock('../../Common/Fetch', () => ({
  fetchGetWithinPage: jest.fn(),
  fetchPostWithinPage: jest.fn(),
}));
jest.mock('../../Common/Browser', () => ({
  buildContextOptions: jest.fn().mockReturnValue({}),
}));
jest.mock('../../Common/Waiting', () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
  humanDelay: jest.fn().mockResolvedValue(undefined),
  waitUntil: jest.fn().mockResolvedValue(undefined),
  runSerial: jest.fn(<T>(actions: (() => Promise<T>)[]): Promise<T[]> => {
    let acc = Promise.resolve([]) as Promise<T[]>;
    for (const action of actions) acc = acc.then(async r => [...r, await action()]);
    return acc;
  }),
  TimeoutError: class TimeoutError extends Error {},
  SECOND: 1000,
}));
jest.mock('../../Common/Transactions', () => ({
  fixInstallments: jest.fn(<T>(txns: T[]) => txns),
  filterOldTransactions: jest.fn(<T>(txns: T[]) => txns),
  getRawTransaction: jest.fn((data: unknown) => data),
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
jest.mock('../../Common/Dates', () => jest.fn(() => [moment('2024-06-01')]));

const MOCK_CONTEXT = { newPage: jest.fn(), close: jest.fn().mockResolvedValue(undefined) };
const MOCK_BROWSER = {
  newContext: jest.fn().mockResolvedValue(MOCK_CONTEXT),
  close: jest.fn().mockResolvedValue(undefined),
};

const CREDS = { id: '123456789', password: 'pass123', card6Digits: '123456' };

/**
 * Mocks a validate response.
 *
 * @param returnCode - the return code in ValidateIdDataBean
 * @param userName - the user name in ValidateIdDataBean
 * @returns the jest mock for further configuration
 */
function mockValidate(returnCode = '1', userName = 'TestUser'): jest.Mock {
  return (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce({
    isFound: true,
    value: {
      Header: { Status: '1' },
      ValidateIdDataBean: { returnCode, userName },
    },
  });
}

/**
 * Mocks a login response.
 *
 * @param status - the login status code
 * @returns the jest mock for further configuration
 */
function mockLogin(status = '1'): jest.Mock {
  return (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce({
    isFound: true,
    value: { status },
  });
}

/**
 * Configures mocks for a successful validate + login sequence.
 *
 * @returns the jest mock for the login call
 */
function setupFullLogin(): jest.Mock {
  mockValidate('1');
  return mockLogin('1');
}

beforeEach(() => {
  faker.seed(42);
  jest.clearAllMocks();
  (launchWithEngine as jest.Mock).mockResolvedValue(MOCK_BROWSER);
  const freshPage = createMockPage();
  MOCK_CONTEXT.newPage.mockResolvedValue(freshPage);
  // Default: any unmatched fetchGetWithinPage calls return isFound:false (empty response)
  (fetchGetWithinPage as jest.Mock).mockResolvedValue({ isFound: false });
});

describe('login', () => {
  it('succeeds with valid credentials', async () => {
    setupFullLogin();
    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.success).toBe(true);
    expect(buildContextOptions).toHaveBeenCalled();
  });

  it('returns ChangePassword when returnCode=4', async () => {
    mockValidate('4');
    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.ChangePassword);
  });

  it('returns InvalidPassword when returnCode is unknown', async () => {
    mockValidate('99');
    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
  });

  it('returns ChangePassword when login status=3', async () => {
    mockValidate('1');
    mockLogin('3');
    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.ChangePassword);
  });

  it('returns InvalidPassword when login status is unknown', async () => {
    mockValidate('1');
    mockLogin('9');
    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
  });

  it('returns WafBlocked with details when validateCredentials returns isFound:false', async () => {
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce({ isFound: false });
    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.WafBlocked);
    expect(result.errorMessage).toContain('WAF blocked');
    expect(result.errorDetails).toBeDefined();
    expect(result.errorDetails?.suggestions.length).toBeGreaterThan(0);
  });

  it('returns WafBlocked when validate Header.Status is not 1', async () => {
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce({
      isFound: true,
      value: { Header: { Status: '0' } },
    });
    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.WafBlocked);
    expect(result.errorDetails).toBeDefined();
  });
});
