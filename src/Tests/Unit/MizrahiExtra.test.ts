import { chromium } from 'playwright-extra';

import { fetchPostWithinPage } from '../../Common/Fetch';
import MizrahiScraper from '../../Scrapers/Mizrahi/MizrahiScraper';
import { TransactionStatuses } from '../../Transactions';
import { createMockPage, createMockScraperOptions } from '../MockPage';

jest.mock('playwright-extra', () => ({ chromium: { launch: jest.fn(), use: jest.fn() } }));
jest.mock('puppeteer-extra-plugin-stealth', () => jest.fn());
jest.mock('../../Common/Fetch', () => ({ fetchPostWithinPage: jest.fn() }));
jest.mock('../../Common/ElementsInteractions', () => ({
  clickButton: jest.fn().mockResolvedValue(undefined),
  fillInput: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
  waitUntilElementDisappear: jest.fn().mockResolvedValue(undefined),
  waitUntilIframeFound: jest
    .fn()
    .mockResolvedValue({ waitForSelector: jest.fn().mockRejectedValue(new Error('not found')) }),
  elementPresentOnPage: jest.fn().mockResolvedValue(false),
  pageEvalAll: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../Common/Navigation', () => ({
  getCurrentUrl: jest
    .fn()
    .mockResolvedValue('https://mto.mizrahi-tefahot.co.il/OnlineApp/dashboard'),
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
  waitForUrl: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../Common/Browser', () => ({
  buildContextOptions: jest.fn().mockReturnValue({}),
}));
jest.mock('../../Common/Transactions', () => ({
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

const MOCK_CONTEXT = {
  newPage: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};
const MOCK_BROWSER = {
  newContext: jest.fn().mockResolvedValue(MOCK_CONTEXT),
  close: jest.fn().mockResolvedValue(undefined),
};

const CREDS = { username: 'testuser', password: 'testpass' };

interface MizrahiScrapedTxn {
  RecTypeSpecified: boolean;
  MC02PeulaTaaEZ: string;
  MC02SchumEZ: number;
  MC02AsmahtaMekoritEZ: string;
  MC02TnuaTeurEZ: string;
  IsTodayTransaction: boolean;
  MC02ErehTaaEZ: string;
  MC02ShowDetailsEZ?: string;
  TransactionNumber: string | number | null;
}

/**
 * Creates a mock MizrahiScrapedTxn for extra Mizrahi unit tests.
 *
 * @param overrides - optional field overrides for the mock transaction
 * @returns a MizrahiScrapedTxn for testing
 */
function scrapedTxn(overrides: Partial<MizrahiScrapedTxn> = {}): MizrahiScrapedTxn {
  return {
    RecTypeSpecified: true,
    MC02PeulaTaaEZ: '2025-06-15T10:00:00',
    MC02SchumEZ: -150,
    MC02AsmahtaMekoritEZ: '12345',
    MC02TnuaTeurEZ: 'העברה בנקאית',
    IsTodayTransaction: false,
    MC02ErehTaaEZ: '2025-06-16T00:00:00',
    MC02ShowDetailsEZ: '0',
    TransactionNumber: null,
    ...overrides,
  };
}

/**
 * Creates a mock Mizrahi API transaction response.
 *
 * @param rows - the transaction rows for the response
 * @param balance - the account balance string
 * @returns a mock API response object
 */
function mockApiResponse(rows: MizrahiScrapedTxn[] = [], balance = '5000'): object {
  return {
    header: { success: true, messages: [] },
    body: { fields: { Yitra: balance }, table: { rows } },
  };
}

/**
 * Creates a mock Mizrahi more-details API response.
 *
 * @param fields - the Label/Value field pairs for the response
 * @returns a mock more-details API response object
 */
function mockDetailsResponse(fields: { Label: string; Value: string }[]): object {
  return { body: { fields: [[{ Records: [{ Fields: fields }] }]] } };
}

/**
 * Creates a mock page for Mizrahi extra tests with API request interception.
 *
 * @returns a mock page configured for Mizrahi extra tests
 */
function createMizrahiPage(): ReturnType<typeof createMockPage> {
  const mockRequest = {
    /**
     * Returns the mock POST data for the Mizrahi API request.
     *
     * @returns serialized JSON with table property
     */
    postData: (): string => JSON.stringify({ table: {} }),
    /**
     * Returns the mock request headers for the Mizrahi API.
     *
     * @returns headers map with XSRF and content-type
     */
    headers: (): Record<string, string> => ({
      mizrahixsrftoken: 'xsrf-token',
      'content-type': 'application/json',
    }),
  };

  return createMockPage({
    $eval: jest.fn().mockResolvedValue(undefined),
    $$: jest.fn().mockResolvedValue([{ click: jest.fn() }]),
    $: jest.fn().mockResolvedValue({
      getProperty: jest.fn().mockResolvedValue({
        jsonValue: jest.fn().mockResolvedValue('ACC-12345'),
      }),
    }),
    waitForRequest: jest.fn().mockResolvedValue(mockRequest),
    waitForSelector: jest.fn().mockResolvedValue(undefined),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (chromium.launch as jest.Mock).mockResolvedValue(MOCK_BROWSER);
  const freshPage = createMizrahiPage();
  MOCK_CONTEXT.newPage.mockResolvedValue(freshPage);
});

describe('fetchData feature flags', () => {
  it('marks transactions with generic description as pending when feature flag enabled', async () => {
    const txnGeneric1 = scrapedTxn({ MC02TnuaTeurEZ: 'העברת יומן לבנק זר מסניף זר' });
    const respGeneric1 = mockApiResponse([txnGeneric1]);
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(respGeneric1);

    const scraper = new MizrahiScraper(
      createMockScraperOptions({ optInFeatures: ['mizrahi:pendingIfHasGenericDescription'] }),
    );
    const result = await scraper.scrape(CREDS);

    expect((result.accounts ?? [])[0].txns[0].status).toBe(TransactionStatuses.Pending);
  });

  it('does not mark generic description as pending without feature flag', async () => {
    const txnGeneric2 = scrapedTxn({ MC02TnuaTeurEZ: 'העברת יומן לבנק זר מסניף זר' });
    const respGeneric2 = mockApiResponse([txnGeneric2]);
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(respGeneric2);

    const scraper = new MizrahiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect((result.accounts ?? [])[0].txns[0].status).toBe(TransactionStatuses.Completed);
  });

  it('fetches extra transaction details when shouldAddTransactionInformation enabled', async () => {
    const txnDetail1 = scrapedTxn({ MC02ShowDetailsEZ: '1' });
    const respDetail1 = mockApiResponse([txnDetail1]);
    const detailsResp1 = mockDetailsResponse([
      { Label: 'שם', Value: 'John Doe' },
      { Label: 'מהות', Value: 'Transfer' },
    ]);
    (fetchPostWithinPage as jest.Mock)
      .mockResolvedValueOnce(respDetail1)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(detailsResp1);

    const scraper = new MizrahiScraper(
      createMockScraperOptions({ shouldAddTransactionInformation: true }),
    );
    const result = await scraper.scrape(CREDS);

    expect((result.accounts ?? [])[0].txns[0].memo).toContain('John Doe');
    expect((result.accounts ?? [])[0].txns[0].memo).toContain('Transfer');
  });

  it('skips extra details when MC02ShowDetailsEZ is not 1', async () => {
    const txnSkip = scrapedTxn({ MC02ShowDetailsEZ: '0' });
    const respSkip = mockApiResponse([txnSkip]);
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(respSkip);

    const scraper = new MizrahiScraper(
      createMockScraperOptions({ shouldAddTransactionInformation: true }),
    );
    const result = await scraper.scrape(CREDS);

    expect((result.accounts ?? [])[0].txns[0].memo).toBeUndefined();
  });

  it('handles extra details fetch error gracefully', async () => {
    const txnErr = scrapedTxn({ MC02ShowDetailsEZ: '1' });
    const respErr = mockApiResponse([txnErr]);
    (fetchPostWithinPage as jest.Mock)
      .mockResolvedValueOnce(respErr)
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('Network error'));

    const scraper = new MizrahiScraper(
      createMockScraperOptions({ shouldAddTransactionInformation: true }),
    );
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect((result.accounts ?? [])[0].txns[0].memo).toBeUndefined();
  });

  it('returns undefined identifier when MC02AsmahtaMekoritEZ is empty', async () => {
    const txnEmptyId = scrapedTxn({ MC02AsmahtaMekoritEZ: '' });
    const respEmptyId = mockApiResponse([txnEmptyId]);
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(respEmptyId);

    const scraper = new MizrahiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect((result.accounts ?? [])[0].txns[0].identifier).toBeUndefined();
  });

  it('uses integer identifier when TransactionNumber is 1', async () => {
    const txnTrNum = scrapedTxn({ MC02AsmahtaMekoritEZ: '55555', TransactionNumber: '1' });
    const respTrNum = mockApiResponse([txnTrNum]);
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(respTrNum);

    const scraper = new MizrahiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect((result.accounts ?? [])[0].txns[0].identifier).toBe(55555);
  });

  it('filters transactions before start date', async () => {
    const oldDate = '2020-01-01T10:00:00';
    const txnOld = scrapedTxn({ MC02PeulaTaaEZ: oldDate });
    const txnNew = scrapedTxn();
    const respFiltered = mockApiResponse([txnOld, txnNew]);
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(respFiltered);

    const scraper = new MizrahiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect((result.accounts ?? [])[0].txns).toHaveLength(1);
  });

  it('includes rawTransaction with additionalInformation when details enabled', async () => {
    const txnRawFull = scrapedTxn({ MC02ShowDetailsEZ: '1' });
    const respRawFull = mockApiResponse([txnRawFull]);
    const detailsRespFull = mockDetailsResponse([{ Label: 'חשבון', Value: '12345' }]);
    (fetchPostWithinPage as jest.Mock)
      .mockResolvedValueOnce(respRawFull)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(detailsRespFull);

    const scraper = new MizrahiScraper(
      createMockScraperOptions({
        shouldAddTransactionInformation: true,
        includeRawTransaction: true,
      }),
    );
    const result = await scraper.scrape(CREDS);

    expect((result.accounts ?? [])[0].txns[0].rawTransaction).toBeDefined();
  });
});
