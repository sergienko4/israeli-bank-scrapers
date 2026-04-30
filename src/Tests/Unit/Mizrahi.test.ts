import { jest } from '@jest/globals';

import { buildMockLocator, mockFrameLocator } from '../MizrahiFixtures.js';

jest.unstable_mockModule('../../Common/CamoufoxLauncher.js', () => ({ launchCamoufox: jest.fn() }));
jest.unstable_mockModule('../../Common/Fetch.js', () => ({ fetchPostWithinPage: jest.fn() }));
const FRAME_LOC = mockFrameLocator();
const MOCK_IFRAME = { locator: jest.fn().mockReturnValue(FRAME_LOC) };
jest.unstable_mockModule('../../Common/ElementsInteractions.js', () => ({
  clickButton: jest.fn().mockResolvedValue(undefined),
  fillInput: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
  waitUntilElementDisappear: jest.fn().mockResolvedValue(undefined),
  waitUntilIframeFound: jest.fn().mockResolvedValue(MOCK_IFRAME),
  elementPresentOnPage: jest.fn().mockResolvedValue(false),
  pageEvalAll: jest.fn().mockResolvedValue([]),
}));
const DASHBOARD_URL = 'https://mto.mizrahi-tefahot.co.il/OnlineApp/dashboard';
jest.unstable_mockModule('../../Common/Navigation.js', () => ({
  getCurrentUrl: jest.fn().mockResolvedValue(DASHBOARD_URL),
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
  waitForUrl: jest.fn().mockResolvedValue(undefined),
  waitForNavigationAndDomLoad: jest.fn().mockResolvedValue(undefined),
  waitForRedirect: jest.fn().mockResolvedValue(undefined),
}));
jest.unstable_mockModule('../../Common/Browser.js', () => ({
  buildContextOptions: jest.fn().mockReturnValue({}),
}));
jest.unstable_mockModule('../../Common/Transactions.js', () => ({
  getRawTransaction: jest.fn((data: Record<string, string>) => data),
}));
/**
 * Creates stub logger for Debug module mock.
 * @returns record of jest.fn() stubs for each log level.
 */
function stubLogger(): Record<string, jest.Mock> {
  return { trace: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}
jest.unstable_mockModule('../../Common/Debug.js', () => ({
  getDebug: stubLogger,
  /**
   * Passthrough mock for bank context.
   * @param _b - unused.
   * @param fn - fn to run.
   * @returns fn result.
   */
  runWithBankContext: <T>(_b: string, fn: () => T): T => fn(),
}));

const { buildContextOptions: BUILD_CTX } = await import('../../Common/Browser.js');
const { launchCamoufox: LAUNCH } = await import('../../Common/CamoufoxLauncher.js');
const { elementPresentOnPage: EL_PRESENT } = await import('../../Common/ElementsInteractions.js');
const { fetchPostWithinPage: FETCH_POST } = await import('../../Common/Fetch.js');
const { getCurrentUrl: GET_URL } = await import('../../Common/Navigation.js');
const { default: MIZRAHI_CLS } = await import('../../Scrapers/Mizrahi/MizrahiScraper.js');
const { TransactionStatuses: STATUSES, TransactionTypes: TYPES } =
  await import('../../Transactions.js');
const { createMockPage: MK_PAGE, createMockScraperOptions: MK_OPTS } =
  await import('../MockPage.js');
const {
  createMizrahiPage: MK_MIZRAHI_PAGE,
  mockApiResponse: API_RESP,
  mockDetailsResponse: DETAIL_RESP,
  scrapedTxn: TXN,
} = await import('../MizrahiFixtures.js');

const MOCK_CTX = { newPage: jest.fn(), close: jest.fn().mockResolvedValue(undefined) };
const MOCK_BROWSER = {
  newContext: jest.fn().mockResolvedValue(MOCK_CTX),
  close: jest.fn().mockResolvedValue(undefined),
};
const CREDS = { username: 'fixt-u-7c2f3e9a', password: 'fixt-p-9b41ad2e' };

/**
 * Creates a Mizrahi mock page using the shared fixture.
 * @returns mock page with Mizrahi-specific stubs.
 */
function buildPage(): ReturnType<typeof MK_PAGE> {
  return MK_MIZRAHI_PAGE(MK_PAGE) as ReturnType<typeof MK_PAGE>;
}

beforeEach(() => {
  jest.clearAllMocks();
  (LAUNCH as jest.Mock).mockResolvedValue(MOCK_BROWSER);
  const page = buildPage();
  MOCK_CTX.newPage.mockResolvedValue(page);
  (GET_URL as jest.Mock).mockResolvedValue(DASHBOARD_URL);
  (EL_PRESENT as jest.Mock).mockResolvedValue(false);
});

describe('login', () => {
  it('succeeds with valid credentials', async () => {
    const apiData = API_RESP([TXN()]);
    (FETCH_POST as jest.Mock).mockResolvedValueOnce(apiData);
    const scraper = new MIZRAHI_CLS(MK_OPTS());
    const result = await scraper.scrape(CREDS);
    expect(result.success).toBe(true);
    expect(BUILD_CTX).toHaveBeenCalled();
  });
});

describe('fetchData', () => {
  it('fetches and converts transactions', async () => {
    const apiData = API_RESP([TXN({ MC02SchumEZ: -250, MC02TnuaTeurEZ: 'רמי לוי' })]);
    (FETCH_POST as jest.Mock).mockResolvedValueOnce(apiData);
    const scraper = new MIZRAHI_CLS(MK_OPTS());
    const result = await scraper.scrape(CREDS);
    expect(result.success).toBe(true);
    const accounts = result.accounts ?? [];
    expect(accounts).toHaveLength(1);
    expect(accounts[0].accountNumber).toBe('ACC-12345');
    const txn = accounts[0].txns[0];
    expect(txn.originalAmount).toBe(-250);
    expect(txn.type).toBe(TYPES.Normal);
    expect(txn.status).toBe(STATUSES.Completed);
    expect(txn.description).toBe('רמי לוי');
  });

  it('filters rows by RecTypeSpecified', async () => {
    const apiData = API_RESP([TXN(), TXN({ RecTypeSpecified: false })]);
    (FETCH_POST as jest.Mock).mockResolvedValueOnce(apiData);
    const result = await new MIZRAHI_CLS(MK_OPTS()).scrape(CREDS);
    expect((result.accounts ?? [])[0].txns).toHaveLength(1);
  });
  it('returns error when API response is unsuccessful', async () => {
    (FETCH_POST as jest.Mock).mockResolvedValueOnce({
      header: { success: false, messages: [{ text: 'Error occurred' }] },
      body: { fields: {}, table: { rows: [] } },
    });
    const result = await new MIZRAHI_CLS(MK_OPTS()).scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('Error occurred');
  });
  it('returns error when account number not found', async () => {
    const page = buildPage();
    const noAttrLocator = buildMockLocator();
    noAttrLocator.getAttribute.mockResolvedValue(null);
    page.locator.mockReturnValue(noAttrLocator);
    MOCK_CTX.newPage.mockResolvedValue(page);
    const result = await new MIZRAHI_CLS(MK_OPTS()).scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('Account number not found');
  });
  it('marks today transactions as pending when feature flag enabled', async () => {
    const apiData = API_RESP([TXN({ IsTodayTransaction: true })]);
    (FETCH_POST as jest.Mock).mockResolvedValueOnce(apiData);
    const opts = MK_OPTS({ optInFeatures: ['mizrahi:isPendingIfTodayTransaction'] });
    const result = await new MIZRAHI_CLS(opts).scrape(CREDS);
    expect((result.accounts ?? [])[0].txns[0].status).toBe(STATUSES.Pending);
  });
  it('marks transactions without identifier as pending when feature flag enabled', async () => {
    const apiData = API_RESP([TXN({ MC02AsmahtaMekoritEZ: '' })]);
    (FETCH_POST as jest.Mock).mockResolvedValueOnce(apiData);
    const opts = MK_OPTS({ optInFeatures: ['mizrahi:pendingIfNoIdentifier'] });
    const result = await new MIZRAHI_CLS(opts).scrape(CREDS);
    expect((result.accounts ?? [])[0].txns[0].status).toBe(STATUSES.Pending);
  });
  it('builds compound identifier with TransactionNumber', async () => {
    const apiData = API_RESP([TXN({ MC02AsmahtaMekoritEZ: '999', TransactionNumber: '5' })]);
    (FETCH_POST as jest.Mock).mockResolvedValueOnce(apiData);
    const result = await new MIZRAHI_CLS(MK_OPTS()).scrape(CREDS);
    expect((result.accounts ?? [])[0].txns[0].identifier).toBe('999-5');
  });
  it('parses identifier as integer when no TransactionNumber', async () => {
    const apiData = API_RESP([TXN({ MC02AsmahtaMekoritEZ: '12345', TransactionNumber: null })]);
    (FETCH_POST as jest.Mock).mockResolvedValueOnce(apiData);
    const result = await new MIZRAHI_CLS(MK_OPTS()).scrape(CREDS);
    expect((result.accounts ?? [])[0].txns[0].identifier).toBe(12345);
  });
  it('extracts balance from response', async () => {
    const apiData = API_RESP([TXN()], '15000');
    (FETCH_POST as jest.Mock).mockResolvedValueOnce(apiData);
    const result = await new MIZRAHI_CLS(MK_OPTS()).scrape(CREDS);
    expect((result.accounts ?? [])[0].balance).toBe(15000);
  });
  it('includes rawTransaction when option set', async () => {
    const apiData = API_RESP([TXN()]);
    (FETCH_POST as jest.Mock).mockResolvedValueOnce(apiData);
    const result = await new MIZRAHI_CLS(MK_OPTS({ includeRawTransaction: true })).scrape(CREDS);
    expect((result.accounts ?? [])[0].txns[0].rawTransaction).toBeDefined();
  });
  it('returns error when API response is null', async () => {
    (FETCH_POST as jest.Mock).mockResolvedValueOnce(null);
    const result = await new MIZRAHI_CLS(MK_OPTS()).scrape(CREDS);
    expect(result.success).toBe(false);
  });

  it('returns empty accounts when no accounts found in dropdown', async () => {
    const page = buildPage();
    const emptyLocator = buildMockLocator({ count: 0, all: [] });
    page.locator.mockReturnValue(emptyLocator);
    page.url.mockReturnValue('https://mto.mizrahi-tefahot.co.il/OnlineApp/dashboard');
    MOCK_CTX.newPage.mockResolvedValue(page);
    const result = await new MIZRAHI_CLS(MK_OPTS()).scrape(CREDS);
    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(0);
  });

  it('handles multiple accounts', async () => {
    const page = buildPage();
    const multiLocator = buildMockLocator({
      count: 2,
      all: [{ click: jest.fn() }, { click: jest.fn() }],
    });
    page.locator.mockReturnValue(multiLocator);
    MOCK_CTX.newPage.mockResolvedValue(page);
    const acc1 = API_RESP([TXN({ MC02TnuaTeurEZ: 'Acc1' })]);
    const acc2 = API_RESP([TXN({ MC02TnuaTeurEZ: 'Acc2' })]);
    (FETCH_POST as jest.Mock)
      .mockResolvedValueOnce(acc1)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(acc2)
      .mockResolvedValueOnce(null);
    const result = await new MIZRAHI_CLS(MK_OPTS()).scrape(CREDS);
    expect(result.success).toBe(true);
    const accounts = result.accounts ?? [];
    expect(accounts).toHaveLength(2);
    expect(accounts[0].txns[0].description).toBe('Acc1');
    expect(accounts[1].txns[0].description).toBe('Acc2');
  });

  it('marks generic description as pending when feature flag enabled', async () => {
    const apiData = API_RESP([TXN({ MC02TnuaTeurEZ: 'העברת יומן לבנק זר מסניף זר' })]);
    (FETCH_POST as jest.Mock).mockResolvedValueOnce(apiData);
    const opts = MK_OPTS({ optInFeatures: ['mizrahi:pendingIfHasGenericDescription'] });
    const result = await new MIZRAHI_CLS(opts).scrape(CREDS);
    expect((result.accounts ?? [])[0].txns[0].status).toBe(STATUSES.Pending);
  });

  it('does not mark generic description as pending without flag', async () => {
    const apiData = API_RESP([TXN({ MC02TnuaTeurEZ: 'העברת יומן לבנק זר מסניף זר' })]);
    (FETCH_POST as jest.Mock).mockResolvedValueOnce(apiData);
    const result = await new MIZRAHI_CLS(MK_OPTS()).scrape(CREDS);
    expect((result.accounts ?? [])[0].txns[0].status).toBe(STATUSES.Completed);
  });

  it('fetches extra transaction details when enabled', async () => {
    const mainData = API_RESP([TXN({ MC02ShowDetailsEZ: '1' })]);
    const detailsData = DETAIL_RESP([
      { Label: 'שם', Value: 'John Doe' },
      { Label: 'מהות', Value: 'Transfer' },
    ]);
    (FETCH_POST as jest.Mock)
      .mockResolvedValueOnce(mainData)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(detailsData);
    const result = await new MIZRAHI_CLS(MK_OPTS({ shouldAddTransactionInformation: true })).scrape(
      CREDS,
    );
    const accounts = result.accounts ?? [];
    expect(accounts[0].txns[0].memo).toContain('John Doe');
    expect(accounts[0].txns[0].memo).toContain('Transfer');
  });

  it('skips extra details when MC02ShowDetailsEZ is not 1', async () => {
    const apiData = API_RESP([TXN({ MC02ShowDetailsEZ: '0' })]);
    (FETCH_POST as jest.Mock).mockResolvedValueOnce(apiData);
    const result = await new MIZRAHI_CLS(MK_OPTS({ shouldAddTransactionInformation: true })).scrape(
      CREDS,
    );
    expect((result.accounts ?? [])[0].txns[0].memo).toBeUndefined();
  });

  it('handles extra details fetch error gracefully', async () => {
    const mainData = API_RESP([TXN({ MC02ShowDetailsEZ: '1' })]);
    (FETCH_POST as jest.Mock)
      .mockResolvedValueOnce(mainData)
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('Network error'));
    const result = await new MIZRAHI_CLS(MK_OPTS({ shouldAddTransactionInformation: true })).scrape(
      CREDS,
    );
    expect(result.success).toBe(true);
    expect((result.accounts ?? [])[0].txns[0].memo).toBeUndefined();
  });

  it('returns undefined identifier when MC02AsmahtaMekoritEZ is empty', async () => {
    const apiData = API_RESP([TXN({ MC02AsmahtaMekoritEZ: '' })]);
    (FETCH_POST as jest.Mock).mockResolvedValueOnce(apiData);
    const result = await new MIZRAHI_CLS(MK_OPTS()).scrape(CREDS);
    expect((result.accounts ?? [])[0].txns[0].identifier).toBe('');
  });

  it('uses integer identifier when TransactionNumber is 1', async () => {
    const apiData = API_RESP([TXN({ MC02AsmahtaMekoritEZ: '55555', TransactionNumber: '1' })]);
    (FETCH_POST as jest.Mock).mockResolvedValueOnce(apiData);
    const result = await new MIZRAHI_CLS(MK_OPTS()).scrape(CREDS);
    expect((result.accounts ?? [])[0].txns[0].identifier).toBe(55555);
  });

  it('filters transactions before start date', async () => {
    const apiData = API_RESP([TXN({ MC02PeulaTaaEZ: '2020-01-01T10:00:00' }), TXN()]);
    (FETCH_POST as jest.Mock).mockResolvedValueOnce(apiData);
    const result = await new MIZRAHI_CLS(MK_OPTS()).scrape(CREDS);
    expect((result.accounts ?? [])[0].txns).toHaveLength(1);
  });

  it('includes rawTransaction with additionalInformation when details enabled', async () => {
    const mainData = API_RESP([TXN({ MC02ShowDetailsEZ: '1' })]);
    const detailsData = DETAIL_RESP([{ Label: 'חשבון', Value: '12345' }]);
    (FETCH_POST as jest.Mock)
      .mockResolvedValueOnce(mainData)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(detailsData);
    const result = await new MIZRAHI_CLS(
      MK_OPTS({ shouldAddTransactionInformation: true, includeRawTransaction: true }),
    ).scrape(CREDS);
    expect((result.accounts ?? [])[0].txns[0].rawTransaction).toBeDefined();
  });
});
