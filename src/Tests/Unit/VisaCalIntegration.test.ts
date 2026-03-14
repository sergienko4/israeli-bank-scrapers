import { jest } from '@jest/globals';

import {
  createBrowserMock,
  createCamoufoxMock,
  createDebugMock,
  createElementsMock,
  createFetchMock,
  createNavigationMock,
  createStorageMock,
  createWaitingMock,
} from '../MockModuleFactories.js';
import {
  VISACAL_CONNECT_AUTH_URL,
  VISACAL_CONNECT_LOGIN_URL,
  VISACAL_LOGIN_URL,
  VISACAL_SUCCESS_URL,
} from '../TestConstants.js';

jest.unstable_mockModule('../../Common/CamoufoxLauncher.js', createCamoufoxMock);
jest.unstable_mockModule('../../Common/Fetch.js', createFetchMock);
jest.unstable_mockModule('../../Common/Storage.js', createStorageMock);
jest.unstable_mockModule('../../Common/Browser.js', createBrowserMock);
jest.unstable_mockModule('../../Common/Navigation.js', () =>
  createNavigationMock(VISACAL_SUCCESS_URL),
);
jest.unstable_mockModule(
  '../../Common/Transactions.js',
  /**
   * Mock Transactions with passthrough filter.
   * @returns Mocked module.
   */
  () => ({
    filterOldTransactions: jest.fn(<T>(txns: T[]): T[] => txns),
    getRawTransaction: jest.fn(
      (data: Record<string, string | number>): Record<string, string | number> => data,
    ),
  }),
);
jest.unstable_mockModule('../../Common/Waiting.js', createWaitingMock);
jest.unstable_mockModule('../../Common/Debug.js', createDebugMock);

jest.unstable_mockModule('../../Common/ElementsInteractions.js', () => ({
  ...createElementsMock(),
  waitUntilIframeFound: jest.fn().mockResolvedValue({
    /**
     * Get the VisaCal connect login URL.
     * @returns VisaCal connect login URL.
     */
    url: (): string => VISACAL_CONNECT_LOGIN_URL,
  }),
}));

const { launchCamoufox: LAUNCH_CAMOUFOX } = await import('../../Common/CamoufoxLauncher.js');
const { elementPresentOnPage: ELEMENT_PRESENT, pageEval: PAGE_EVAL } =
  await import('../../Common/ElementsInteractions.js');
const { fetchPostWithinPage: FETCH_POST } = await import('../../Common/Fetch.js');
const { getCurrentUrl: GET_CURRENT_URL } = await import('../../Common/Navigation.js');
const { getFromSessionStorage: GET_SESSION_STORAGE } = await import('../../Common/Storage.js');
const { waitUntil: WAIT_UNTIL } = await import('../../Common/Waiting.js');
const { ScraperErrorTypes: ERROR_TYPES } = await import('../../Scrapers/Base/Errors.js');
const { default: VISA_CAL_SCRAPER } = await import('../../Scrapers/VisaCal/VisaCalScraper.js');
const { createMockPage: CREATE_MOCK_PAGE, createMockScraperOptions: CREATE_OPTS } =
  await import('../MockPage.js');
const FIXTURES = await import('./VisaCalFixtures.js');
const INTEGRATION = await import('../IntegrationHelpers.js');

interface ISessionData {
  result?: { cards: { cardUniqueId: string; last4Digits: string }[] };
  auth?: { calConnectToken: string };
}

/** Empty session data sentinel. */
const EMPTY_SESSION: ISessionData = {};

/** Default card list for session storage mock. */
const DEFAULT_CARDS: { cardUniqueId: string; last4Digits: string }[] = [
  { cardUniqueId: 'card-1', last4Digits: '4580' },
];

/**
 * Build VisaCal scraper options with defaults.
 * @param overrides - Option overrides.
 * @returns Scraper options for VisaCal.
 */
function visaCalOptions(
  overrides: Partial<ReturnType<typeof CREATE_OPTS>> = {},
): ReturnType<typeof CREATE_OPTS> {
  return CREATE_OPTS({ startDate: new Date(), futureMonthsToScrape: 0, ...overrides });
}

/**
 * Create a mock login iframe frame object.
 * @returns Frame mock with url() returning connect login URL.
 */
function createLoginFrameMock(): { url: () => string; waitForSelector: jest.Mock } {
  /**
   * Connect login URL getter.
   * @returns Connect login URL.
   */
  const url = (): string => VISACAL_CONNECT_LOGIN_URL;
  return { url, waitForSelector: jest.fn().mockResolvedValue(undefined) };
}

/**
 * Create a mock request object for auth response.
 * @returns Request mock with method() returning POST.
 */
function createAuthRequestMock(): { method: () => string } {
  /**
   * HTTP method getter.
   * @returns HTTP method string.
   */
  const method = (): string => 'POST';
  return { method };
}

/**
 * Create a mock auth response for waitForResponse.
 * @param token - Auth token to return from json().
 * @returns Response mock with json(), url(), and request().
 */
function createAuthResponseMock(token = 'cal-auth-token'): {
  json: jest.Mock;
  url: () => string;
  request: () => { method: () => string };
} {
  /**
   * Auth API URL getter.
   * @returns Auth API URL.
   */
  const url = (): string => VISACAL_CONNECT_AUTH_URL;
  return { json: jest.fn().mockResolvedValue({ token }), url, request: createAuthRequestMock };
}

/**
 * Create a mock VisaCal page with login iframe and auth response.
 * @returns mock page object.
 */
function createMockVisaCalPage(): ReturnType<typeof CREATE_MOCK_PAGE> {
  const frameMock = createLoginFrameMock();
  const responseMock = createAuthResponseMock();
  return CREATE_MOCK_PAGE({
    frames: jest.fn().mockReturnValue([frameMock]),
    waitForResponse: jest.fn().mockResolvedValue(responseMock),
  });
}

/**
 * Configure waitUntil to execute its callback immediately.
 * @returns true when configured.
 */
function mockWaitUntil(): boolean {
  (WAIT_UNTIL as jest.Mock).mockImplementation(
    async <T>(func: () => Promise<T>): Promise<T> => func(),
  );
  return true;
}

/**
 * Resolve session key to the appropriate session data.
 * @param key - Session storage key.
 * @param cards - Card list for the init key.
 * @returns Session data matching the key.
 */
function resolveSessionKey(
  key: string,
  cards: { cardUniqueId: string; last4Digits: string }[],
): ISessionData {
  if (key === 'init') return { result: { cards } };
  if (key === 'auth-module') return { auth: { calConnectToken: 'cal-auth-token' } };
  return EMPTY_SESSION;
}

/**
 * Configure session storage with card and auth data.
 * @param cards - Card list returned for the 'init' key.
 * @returns true when configured.
 */
function mockSessionStorage(
  cards: { cardUniqueId: string; last4Digits: string }[] = DEFAULT_CARDS,
): boolean {
  (GET_SESSION_STORAGE as jest.Mock).mockImplementation(
    (_page: ReturnType<typeof CREATE_MOCK_PAGE>, key: string): Promise<ISessionData> => {
      const data = resolveSessionKey(key, cards);
      return Promise.resolve(data);
    },
  );
  return true;
}

/**
 * Set up mocks for VisaCal login and session flow.
 * @param cards - Card list for session storage (defaults to one card).
 * @returns The mock page object.
 */
function setupVisaCalMocks(
  cards: { cardUniqueId: string; last4Digits: string }[] = DEFAULT_CARDS,
): ReturnType<typeof CREATE_MOCK_PAGE> {
  const page = createMockVisaCalPage();
  FIXTURES.MOCK_CONTEXT.newPage.mockResolvedValue(page);
  mockWaitUntil();
  mockSessionStorage(cards);
  return page;
}

/** Empty bank-issued cards response. */
const EMPTY_BANK_CARDS = { result: { bankIssuedCards: { cardLevelFrames: [] } } };

/** Default pending response (no pending transactions). */
const NO_PENDING: { statusCode: number } = { statusCode: 96 };

/** Fetch response type for card transaction details. */
type TxnDetailsResponse = ReturnType<typeof FIXTURES.mockCardTransactionDetails>;

/**
 * Set up standard fetch mocks for a complete scrape cycle.
 * @param details - The transaction details response.
 * @param pending - The pending transactions response.
 * @returns True when complete.
 */
function setupFetchMocks(
  details: TxnDetailsResponse,
  pending: TxnDetailsResponse | { statusCode: number } = NO_PENDING,
): boolean {
  (FETCH_POST as jest.Mock)
    .mockResolvedValueOnce(FIXTURES.INIT_RESPONSE)
    .mockResolvedValueOnce(EMPTY_BANK_CARDS)
    .mockResolvedValueOnce(details)
    .mockResolvedValueOnce(pending);
  return true;
}

/**
 * Create a mock page configured for invalid login testing.
 * @returns Mock page with empty auth token.
 */
function createInvalidLoginPage(): ReturnType<typeof CREATE_MOCK_PAGE> {
  const frameMock = createLoginFrameMock();
  const responseMock = createAuthResponseMock('');
  return CREATE_MOCK_PAGE({
    url: jest.fn().mockReturnValue(VISACAL_LOGIN_URL),
    waitForURL: jest.fn().mockResolvedValue(undefined),
    frames: jest.fn().mockReturnValue([frameMock]),
    waitForResponse: jest.fn().mockResolvedValue(responseMock),
  });
}

/**
 * Configure mocks for an invalid login scenario.
 * @param page - The mock page to use.
 * @returns true when configured.
 */
function setupInvalidLoginMocks(page: ReturnType<typeof CREATE_MOCK_PAGE>): boolean {
  FIXTURES.MOCK_CONTEXT.newPage.mockResolvedValue(page);
  (GET_CURRENT_URL as jest.Mock).mockResolvedValue(VISACAL_LOGIN_URL);
  (ELEMENT_PRESENT as jest.Mock).mockResolvedValue(true);
  (PAGE_EVAL as jest.Mock).mockResolvedValue('שם המשתמש או הסיסמה שהוזנו שגויים');
  return true;
}

/**
 * Reset fetch and browser mocks to default VisaCal state.
 * @returns true when configured.
 */
function resetVisaCalMocks(): boolean {
  (FETCH_POST as jest.Mock).mockReset();
  (LAUNCH_CAMOUFOX as jest.Mock).mockResolvedValue(FIXTURES.MOCK_BROWSER);
  (GET_CURRENT_URL as jest.Mock).mockResolvedValue(VISACAL_SUCCESS_URL);
  (ELEMENT_PRESENT as jest.Mock).mockResolvedValue(false);
  return true;
}

beforeEach(() => {
  jest.clearAllMocks();
  resetVisaCalMocks();
});

describe('integration: full scrape flow', () => {
  it('happy path: cards + completed transactions with account and amounts', async () => {
    setupVisaCalMocks();
    const txn1 = FIXTURES.scrapedTxn({ trnAmt: 200, merchantName: 'רמי לוי' });
    const txn2 = FIXTURES.scrapedTxn({ trnAmt: 80, merchantName: 'סופר שופ' });
    const details = FIXTURES.mockCardTransactionDetails([txn1, txn2]);
    setupFetchMocks(details);

    const scraper = new VISA_CAL_SCRAPER(visaCalOptions());
    const result = await scraper.scrape(FIXTURES.CREDS);

    const accounts = INTEGRATION.assertSuccess(result, 1);
    expect(accounts[0]?.accountNumber).toBe('4580');
    expect(accounts[0]?.txns).toHaveLength(2);
    expect(accounts[0]?.txns[0]?.originalAmount).toBe(-200);
    expect(accounts[0]?.txns[1]?.originalAmount).toBe(-80);
  });

  it('invalid login: error element in iframe returns InvalidPassword', async () => {
    const loginPage = createInvalidLoginPage();
    setupInvalidLoginMocks(loginPage);

    const scraper = new VISA_CAL_SCRAPER(visaCalOptions());
    const result = await scraper.scrape(FIXTURES.CREDS);

    INTEGRATION.assertFailure(result, ERROR_TYPES.InvalidPassword);
  });

  it('empty data: empty card list from init API with 0 accounts', async () => {
    setupVisaCalMocks([]);
    (FETCH_POST as jest.Mock)
      .mockResolvedValueOnce(FIXTURES.EMPTY_CARDS_INIT_RESPONSE)
      .mockResolvedValueOnce(EMPTY_BANK_CARDS);

    const scraper = new VISA_CAL_SCRAPER(visaCalOptions());
    const result = await scraper.scrape(FIXTURES.CREDS);

    INTEGRATION.assertEmptyTxns(result);
  });
});
