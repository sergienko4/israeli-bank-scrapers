import { jest } from '@jest/globals';

import type { ITestAccountMock } from '../IntegrationHelpers.js';
import {
  createBrowserMock,
  createCamoufoxMock,
  createDebugMock,
  createElementsMock,
  createFetchMock,
  createNavigationMock,
  createOtpMock,
  createTransactionsMock,
  createWaitingMock,
} from '../MockModuleFactories.js';
import { HAPOALIM_LOGIN_ERROR_URL, HAPOALIM_SUCCESS_URL } from '../TestConstants.js';
import type { IHapoalimScrapedTxn } from './HapoalimFixtures.js';

jest.unstable_mockModule('../../Common/CamoufoxLauncher.js', createCamoufoxMock);
jest.unstable_mockModule('../../Common/Fetch.js', createFetchMock);
jest.unstable_mockModule('../../Common/Browser.js', createBrowserMock);
jest.unstable_mockModule('../../Common/Navigation.js', () =>
  createNavigationMock(HAPOALIM_SUCCESS_URL),
);
jest.unstable_mockModule('../../Common/ElementsInteractions.js', createElementsMock);
jest.unstable_mockModule('../../Common/Waiting.js', createWaitingMock);
jest.unstable_mockModule('../../Common/Transactions.js', createTransactionsMock);
jest.unstable_mockModule('../../Common/Debug.js', createDebugMock);
jest.unstable_mockModule('../../Common/OtpHandler.js', createOtpMock);

jest.unstable_mockModule(
  'uuid',
  /**
   * Mock uuid.
   * @returns Mocked module.
   */
  () => ({ v4: jest.fn((): string => 'mock-uuid') }),
);

const { launchCamoufox: LAUNCH_CAMOUFOX } = await import('../../Common/CamoufoxLauncher.js');
const { fetchGetWithinPage: FETCH_GET, fetchPostWithinPage: FETCH_POST } =
  await import('../../Common/Fetch.js');
const { getCurrentUrl: GET_CURRENT_URL } = await import('../../Common/Navigation.js');
const { waitUntil: WAIT_UNTIL } = await import('../../Common/Waiting.js');
const { ScraperErrorTypes: SCRAPER_ERROR_TYPES } = await import('../../Scrapers/Base/Errors.js');
const { default: HAPOALIM_SCRAPER } = await import('../../Scrapers/Hapoalim/HapoalimScraper.js');
const { createMockScraperOptions: CREATE_OPTS } = await import('../MockPage.js');
const FIXTURES = await import('./HapoalimFixtures.js');
const INTEGRATION = await import('../IntegrationHelpers.js');

/**
 * Mock the accounts API response.
 * @param accounts - Account list.
 * @returns True when setup complete.
 */
function mockAccounts(accounts: ITestAccountMock[] = []): boolean {
  (FETCH_GET as jest.Mock).mockResolvedValueOnce(accounts);
  return true;
}

/**
 * Mock the balance API response.
 * @param balance - Balance value.
 * @returns True when setup complete.
 */
function mockBalance(balance = 10000): boolean {
  (FETCH_GET as jest.Mock).mockResolvedValueOnce({ currentBalance: balance });
  return true;
}

/**
 * Mock the transactions API response.
 * @param txns - Transaction list.
 * @returns True when setup complete.
 */
function mockTransactions(txns: IHapoalimScrapedTxn[] = []): boolean {
  (FETCH_POST as jest.Mock).mockResolvedValueOnce({ transactions: txns });
  return true;
}

/**
 * Configure waitUntil mock to execute and resolve its callback.
 * @returns true when setup complete.
 */
function setupWaitUntilMock(): boolean {
  (WAIT_UNTIL as jest.Mock).mockImplementation(
    async (func: () => Promise<boolean>): Promise<boolean> => {
      await func();
      return true;
    },
  );
  return true;
}

/**
 * Wire a Hapoalim page into the context and mock accounts.
 * @param accounts - Account list to mock.
 * @returns The mock page object.
 */
function setupMockAccounts(
  accounts: ITestAccountMock[],
): ReturnType<typeof FIXTURES.createHapoalimPage> {
  const page = FIXTURES.createHapoalimPage();
  FIXTURES.MOCK_CONTEXT.newPage.mockResolvedValue(page);
  mockAccounts(accounts);
  return page;
}

/**
 * Set up login mocks and account data for Hapoalim tests.
 * @param accounts - Account list.
 * @returns The mock page object.
 */
function setupLoginAndAccounts(
  accounts: ITestAccountMock[] = [
    { bankNumber: '12', branchNumber: '345', accountNumber: '678', accountClosingReasonCode: 0 },
  ],
): ReturnType<typeof FIXTURES.createHapoalimPage> {
  setupWaitUntilMock();
  return setupMockAccounts(accounts);
}

beforeEach(
  /**
   * Clear mocks before each test.
   * @returns Test setup flag.
   */
  () => {
    jest.clearAllMocks();
    (FETCH_POST as jest.Mock).mockReset();
    (FETCH_GET as jest.Mock).mockReset();
    (LAUNCH_CAMOUFOX as jest.Mock).mockResolvedValue(FIXTURES.MOCK_BROWSER);
    const page = FIXTURES.createHapoalimPage();
    FIXTURES.MOCK_CONTEXT.newPage.mockResolvedValue(page);
    (GET_CURRENT_URL as jest.Mock).mockResolvedValue(HAPOALIM_SUCCESS_URL);
    return true;
  },
);

describe('integration: full scrape flow', () => {
  it('happy path: accounts, XSRF token, transactions', async () => {
    setupLoginAndAccounts([
      { bankNumber: '12', branchNumber: '345', accountNumber: '678', accountClosingReasonCode: 0 },
    ]);
    mockBalance(25000);
    mockTransactions([
      FIXTURES.scrapedTxn({
        eventAmount: 500,
        activityDescription: 'משכורת',
        eventActivityTypeCode: 1,
      }),
      FIXTURES.scrapedTxn({
        eventAmount: 120,
        activityDescription: 'סופר',
        eventActivityTypeCode: 2,
      }),
    ]);

    const result = await new HAPOALIM_SCRAPER(CREATE_OPTS()).scrape(FIXTURES.CREDS);
    const accounts = INTEGRATION.assertSuccess(result, 1);

    expect(accounts[0].accountNumber).toBe('12-345-678');
    expect(accounts[0].balance).toBe(25000);
    expect(accounts[0].txns).toHaveLength(2);
    expect(accounts[0].txns[0].originalAmount).toBe(500);
    expect(accounts[0].txns[1].originalAmount).toBe(-120);
  });

  it('invalid login: error URL returns InvalidPassword', async () => {
    (GET_CURRENT_URL as jest.Mock).mockResolvedValue(HAPOALIM_LOGIN_ERROR_URL);

    const result = await new HAPOALIM_SCRAPER(CREATE_OPTS()).scrape(FIXTURES.CREDS);
    INTEGRATION.assertFailure(result, SCRAPER_ERROR_TYPES.InvalidPassword);
  });

  it('empty data: no open accounts returns success with 0 accounts', async () => {
    setupLoginAndAccounts([]);

    const result = await new HAPOALIM_SCRAPER(CREATE_OPTS()).scrape(FIXTURES.CREDS);
    INTEGRATION.assertSuccess(result, 0);
    INTEGRATION.assertEmptyTxns(result);
  });
});
