import { buildContextOptions } from '../../Common/Browser';
import { launchWithEngine } from '../../Common/BrowserEngine';
import { elementPresentOnPage } from '../../Common/ElementsInteractions';
import { fetchPostWithinPage } from '../../Common/Fetch';
import { getCurrentUrl } from '../../Common/Navigation';
import { SHEKEL_CURRENCY } from '../../Constants';
import { MIZRAHI_CONFIG } from '../../Scrapers/Mizrahi/MizrahiLoginConfig';
import MizrahiScraper from '../../Scrapers/Mizrahi/MizrahiScraper';
import { TransactionStatuses, TransactionTypes } from '../../Transactions';
import { createMockPage, createMockScraperOptions } from '../MockPage';

jest.mock('../../Common/BrowserEngine', () => ({
  launchWithEngine: jest.fn(),
  getGlobalEngineChain: jest.fn().mockReturnValue(['playwright-stealth']),
  BrowserEngineType: {
    Camoufox: 'camoufox',
    PlaywrightStealth: 'playwright-stealth',
    Rebrowser: 'rebrowser',
    Patchright: 'patchright',
  },
}));
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
  MC02KodGoremEZ?: string;
  MC02SugTnuaKaspitEZ?: string;
  MC02AgidEZ?: string;
  MC02SeifMaralEZ?: string;
  MC02NoseMaralEZ?: string;
  TransactionNumber: string | number | null;
}

/**
 * Creates a mock MizrahiScrapedTxn for unit tests.
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
 * Creates a mock Mizrahi API response with transaction rows and balance.
 *
 * @param rows - the transaction rows to include in the response
 * @param balance - the account balance string
 * @returns a mock API response object
 */
function mockApiResponse(rows: MizrahiScrapedTxn[] = [], balance = '5000'): object {
  return {
    header: { success: true, messages: [] },
    body: {
      fields: { Yitra: balance },
      table: { rows },
    },
  };
}

/**
 * Creates a mock page configured for Mizrahi scraper tests.
 *
 * @returns a mock page with waitForRequest configured for the Mizrahi API
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
     * Returns the mock request headers including the XSRF token.
     *
     * @returns a headers map with XSRF and content-type values
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
  (launchWithEngine as jest.Mock).mockResolvedValue(MOCK_BROWSER);
  const freshPage = createMizrahiPage();
  MOCK_CONTEXT.newPage.mockResolvedValue(freshPage);
  (getCurrentUrl as jest.Mock).mockResolvedValue(
    'https://mto.mizrahi-tefahot.co.il/OnlineApp/dashboard',
  );
  (elementPresentOnPage as jest.Mock).mockResolvedValue(false);
});

describe('login', () => {
  it('succeeds with valid credentials', async () => {
    const txns1 = [scrapedTxn()];
    const resp1 = mockApiResponse(txns1);
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(resp1);

    const scraper = new MizrahiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(buildContextOptions).toHaveBeenCalled();
  });
});

describe('fetchData', () => {
  it('fetches and converts transactions', async () => {
    const txn1 = scrapedTxn({ MC02SchumEZ: -250, MC02TnuaTeurEZ: 'רמי לוי' });
    const resp2 = mockApiResponse([txn1]);
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(resp2);

    const scraper = new MizrahiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(1);
    expect((result.accounts ?? [])[0].accountNumber).toBe('ACC-12345');

    const t = (result.accounts ?? [])[0].txns[0];
    expect(t.originalAmount).toBe(-250);
    expect(t.originalCurrency).toBe(SHEKEL_CURRENCY);
    expect(t.type).toBe(TransactionTypes.Normal);
    expect(t.status).toBe(TransactionStatuses.Completed);
    expect(t.description).toBe('רמי לוי');
  });

  it('filters rows by RecTypeSpecified', async () => {
    const txns2 = [scrapedTxn(), scrapedTxn({ RecTypeSpecified: false })];
    const resp3 = mockApiResponse(txns2);
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(resp3);

    const scraper = new MizrahiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect((result.accounts ?? [])[0].txns).toHaveLength(1);
  });

  it('returns error when API response is unsuccessful', async () => {
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce({
      header: { success: false, messages: [{ text: 'Error occurred' }] },
      body: { fields: {}, table: { rows: [] } },
    });

    const scraper = new MizrahiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('Error occurred');
  });

  it('returns error when account number not found', async () => {
    const page = createMizrahiPage();
    page.$.mockResolvedValue({
      getProperty: jest.fn().mockResolvedValue({
        jsonValue: jest.fn().mockResolvedValue(''),
      }),
    });
    MOCK_CONTEXT.newPage.mockResolvedValue(page);

    const scraper = new MizrahiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('Account number not found');
  });

  it('marks today transactions as pending when feature flag enabled', async () => {
    const txnToday = scrapedTxn({ IsTodayTransaction: true });
    const respToday = mockApiResponse([txnToday]);
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(respToday);

    const scraper = new MizrahiScraper(
      createMockScraperOptions({ optInFeatures: ['mizrahi:isPendingIfTodayTransaction'] }),
    );
    const result = await scraper.scrape(CREDS);

    expect((result.accounts ?? [])[0].txns[0].status).toBe(TransactionStatuses.Pending);
  });

  it('marks transactions without identifier as pending when feature flag enabled', async () => {
    const txnNoId = scrapedTxn({ MC02AsmahtaMekoritEZ: '' });
    const respNoId = mockApiResponse([txnNoId]);
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(respNoId);

    const scraper = new MizrahiScraper(
      createMockScraperOptions({ optInFeatures: ['mizrahi:pendingIfNoIdentifier'] }),
    );
    const result = await scraper.scrape(CREDS);

    expect((result.accounts ?? [])[0].txns[0].status).toBe(TransactionStatuses.Pending);
  });

  it('builds compound identifier with TransactionNumber', async () => {
    const txnCompound = scrapedTxn({ MC02AsmahtaMekoritEZ: '999', TransactionNumber: '5' });
    const respCompound = mockApiResponse([txnCompound]);
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(respCompound);

    const scraper = new MizrahiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect((result.accounts ?? [])[0].txns[0].identifier).toBe('999-5');
  });

  it('parses identifier as integer when no TransactionNumber', async () => {
    const txnInt = scrapedTxn({ MC02AsmahtaMekoritEZ: '12345', TransactionNumber: null });
    const respInt = mockApiResponse([txnInt]);
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(respInt);

    const scraper = new MizrahiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect((result.accounts ?? [])[0].txns[0].identifier).toBe(12345);
  });

  it('extracts balance from response', async () => {
    const txnBal = scrapedTxn();
    const respBal = mockApiResponse([txnBal], '15000');
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(respBal);

    const scraper = new MizrahiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect((result.accounts ?? [])[0].balance).toBe(15000);
  });

  it('includes rawTransaction when option set', async () => {
    const txnRaw = scrapedTxn();
    const respRaw = mockApiResponse([txnRaw]);
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(respRaw);

    const scraper = new MizrahiScraper(createMockScraperOptions({ includeRawTransaction: true }));
    const result = await scraper.scrape(CREDS);

    expect((result.accounts ?? [])[0].txns[0].rawTransaction).toBeDefined();
  });

  it('returns error when API response is null', async () => {
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(null);

    const scraper = new MizrahiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(false);
  });

  it('returns empty accounts when no accounts found in dropdown', async () => {
    const page = createMizrahiPage();
    page.$$.mockResolvedValue([]);
    page.url.mockReturnValue('https://mto.mizrahi-tefahot.co.il/OnlineApp/dashboard');
    MOCK_CONTEXT.newPage.mockResolvedValue(page);

    const scraper = new MizrahiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(0);
  });

  it('handles multiple accounts', async () => {
    const page = createMizrahiPage();
    page.$$.mockResolvedValue([{ click: jest.fn() }, { click: jest.fn() }]);
    MOCK_CONTEXT.newPage.mockResolvedValue(page);

    // Promise.any over 2 URLs consumes 2 mocks per account
    const txnAcc1 = scrapedTxn({ MC02TnuaTeurEZ: 'Acc1' });
    const respAcc1 = mockApiResponse([txnAcc1]);
    const txnAcc2 = scrapedTxn({ MC02TnuaTeurEZ: 'Acc2' });
    const respAcc2 = mockApiResponse([txnAcc2]);
    (fetchPostWithinPage as jest.Mock)
      .mockResolvedValueOnce(respAcc1) // account 1, url 1
      .mockResolvedValueOnce(null) // account 1, url 2 (consumed by Promise.any)
      .mockResolvedValueOnce(respAcc2) // account 2, url 1
      .mockResolvedValueOnce(null); // account 2, url 2 (consumed by Promise.any)

    const scraper = new MizrahiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(2);
    expect((result.accounts ?? [])[0].txns[0].description).toBe('Acc1');
    expect((result.accounts ?? [])[1].txns[0].description).toBe('Acc2');
  });
});

describe('mizrahiPostAction', () => {
  it('resolves when all race participants resolve', async () => {
    const mockPage = createMockPage();
    await MIZRAHI_CONFIG.postAction?.(mockPage);
    // all mocked participants (waitUntilElementFound × 2, waitForNavigation) resolve immediately
  });
});
