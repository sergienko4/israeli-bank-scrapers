import { chromium } from 'playwright';
import { SHEKEL_CURRENCY } from '../constants';
import { fetchPostWithinPage } from '../helpers/fetch';
import { elementPresentOnPage } from '../helpers/elements-interactions';
import { buildContextOptions } from '../helpers/browser';
import { getCurrentUrl } from '../helpers/navigation';
import { createMockPage, createMockScraperOptions } from '../tests/mock-page';
import MizrahiScraper from './mizrahi';
import { TransactionStatuses, TransactionTypes } from '../transactions';

jest.mock('playwright', () => ({ chromium: { launch: jest.fn() } }));
jest.mock('../helpers/fetch', () => ({ fetchPostWithinPage: jest.fn() }));
jest.mock('../helpers/elements-interactions', () => ({
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
jest.mock('../helpers/navigation', () => ({
  getCurrentUrl: jest.fn().mockResolvedValue('https://mto.mizrahi-tefahot.co.il/OnlineApp/dashboard'),
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
  waitForUrl: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../helpers/browser', () => ({
  buildContextOptions: jest.fn().mockReturnValue({}),
}));
jest.mock('../helpers/transactions', () => ({
  getRawTransaction: jest.fn((data: unknown) => data),
}));
jest.mock('../helpers/debug', () => ({ getDebug: () => jest.fn() }));

const mockContext = {
  newPage: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};
const mockBrowser = {
  newContext: jest.fn().mockResolvedValue(mockContext),
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

function mockApiResponse(rows: MizrahiScrapedTxn[] = [], balance = '5000'): object {
  return {
    header: { success: true, messages: [] },
    body: {
      fields: { Yitra: balance },
      table: { rows },
    },
  };
}

function mockDetailsResponse(fields: Array<{ Label: string; Value: string }>): object {
  return { body: { fields: [[{ Records: [{ Fields: fields }] }]] } };
}

function createMizrahiPage(): ReturnType<typeof createMockPage> {
  const mockRequest = {
    postData: () => JSON.stringify({ table: {} }),
    headers: () => ({ mizrahixsrftoken: 'xsrf-token', 'content-type': 'application/json' }),
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
  (chromium.launch as jest.Mock).mockResolvedValue(mockBrowser);
  mockContext.newPage.mockResolvedValue(createMizrahiPage());
  (getCurrentUrl as jest.Mock).mockResolvedValue('https://mto.mizrahi-tefahot.co.il/OnlineApp/dashboard');
  (elementPresentOnPage as jest.Mock).mockResolvedValue(false);
});

describe('login', () => {
  it('succeeds with valid credentials', async () => {
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(mockApiResponse([scrapedTxn()]));

    const scraper = new MizrahiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(buildContextOptions).toHaveBeenCalled();
  });
});

describe('fetchData', () => {
  it('fetches and converts transactions', async () => {
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(
      mockApiResponse([scrapedTxn({ MC02SchumEZ: -250, MC02TnuaTeurEZ: 'רמי לוי' })]),
    );

    const scraper = new MizrahiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts![0].accountNumber).toBe('ACC-12345');

    const t = result.accounts![0].txns[0];
    expect(t.originalAmount).toBe(-250);
    expect(t.originalCurrency).toBe(SHEKEL_CURRENCY);
    expect(t.type).toBe(TransactionTypes.Normal);
    expect(t.status).toBe(TransactionStatuses.Completed);
    expect(t.description).toBe('רמי לוי');
  });

  it('filters rows by RecTypeSpecified', async () => {
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(
      mockApiResponse([scrapedTxn(), scrapedTxn({ RecTypeSpecified: false })]),
    );

    const scraper = new MizrahiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns).toHaveLength(1);
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
    mockContext.newPage.mockResolvedValue(page);

    const scraper = new MizrahiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('Account number not found');
  });

  it('marks today transactions as pending when feature flag enabled', async () => {
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(
      mockApiResponse([scrapedTxn({ IsTodayTransaction: true })]),
    );

    const scraper = new MizrahiScraper(
      createMockScraperOptions({ optInFeatures: ['mizrahi:pendingIfTodayTransaction'] }),
    );
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].status).toBe(TransactionStatuses.Pending);
  });

  it('marks transactions without identifier as pending when feature flag enabled', async () => {
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(
      mockApiResponse([scrapedTxn({ MC02AsmahtaMekoritEZ: '' })]),
    );

    const scraper = new MizrahiScraper(createMockScraperOptions({ optInFeatures: ['mizrahi:pendingIfNoIdentifier'] }));
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].status).toBe(TransactionStatuses.Pending);
  });

  it('builds compound identifier with TransactionNumber', async () => {
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(
      mockApiResponse([scrapedTxn({ MC02AsmahtaMekoritEZ: '999', TransactionNumber: '5' })]),
    );

    const scraper = new MizrahiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].identifier).toBe('999-5');
  });

  it('parses identifier as integer when no TransactionNumber', async () => {
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(
      mockApiResponse([scrapedTxn({ MC02AsmahtaMekoritEZ: '12345', TransactionNumber: null })]),
    );

    const scraper = new MizrahiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].identifier).toBe(12345);
  });

  it('extracts balance from response', async () => {
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(mockApiResponse([scrapedTxn()], '15000'));

    const scraper = new MizrahiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].balance).toBe(15000);
  });

  it('includes rawTransaction when option set', async () => {
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(mockApiResponse([scrapedTxn()]));

    const scraper = new MizrahiScraper(createMockScraperOptions({ includeRawTransaction: true }));
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].rawTransaction).toBeDefined();
  });

  it('returns error when API response is null', async () => {
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(null);

    const scraper = new MizrahiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(false);
  });

  it('handles multiple accounts', async () => {
    const page = createMizrahiPage();
    page.$$.mockResolvedValue([{ click: jest.fn() }, { click: jest.fn() }]);
    mockContext.newPage.mockResolvedValue(page);

    // Promise.any over 2 URLs consumes 2 mocks per account
    (fetchPostWithinPage as jest.Mock)
      .mockResolvedValueOnce(mockApiResponse([scrapedTxn({ MC02TnuaTeurEZ: 'Acc1' })])) // account 1, url 1
      .mockResolvedValueOnce(null) // account 1, url 2 (consumed by Promise.any)
      .mockResolvedValueOnce(mockApiResponse([scrapedTxn({ MC02TnuaTeurEZ: 'Acc2' })])) // account 2, url 1
      .mockResolvedValueOnce(null); // account 2, url 2 (consumed by Promise.any)

    const scraper = new MizrahiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(2);
    expect(result.accounts![0].txns[0].description).toBe('Acc1');
    expect(result.accounts![1].txns[0].description).toBe('Acc2');
  });

  it('marks transactions with generic description as pending when feature flag enabled', async () => {
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(
      mockApiResponse([scrapedTxn({ MC02TnuaTeurEZ: 'העברת יומן לבנק זר מסניף זר' })]),
    );

    const scraper = new MizrahiScraper(
      createMockScraperOptions({ optInFeatures: ['mizrahi:pendingIfHasGenericDescription'] }),
    );
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].status).toBe(TransactionStatuses.Pending);
  });

  it('does not mark generic description as pending without feature flag', async () => {
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(
      mockApiResponse([scrapedTxn({ MC02TnuaTeurEZ: 'העברת יומן לבנק זר מסניף זר' })]),
    );

    const scraper = new MizrahiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].status).toBe(TransactionStatuses.Completed);
  });

  it('fetches extra transaction details when additionalTransactionInformation enabled', async () => {
    (fetchPostWithinPage as jest.Mock)
      .mockResolvedValueOnce(mockApiResponse([scrapedTxn({ MC02ShowDetailsEZ: '1' })])) // url 1
      .mockResolvedValueOnce(null) // url 2 (consumed by Promise.any)
      .mockResolvedValueOnce(
        mockDetailsResponse([
          { Label: 'שם', Value: 'John Doe' },
          { Label: 'מהות', Value: 'Transfer' },
        ]),
      ); // extra details fetch

    const scraper = new MizrahiScraper(createMockScraperOptions({ additionalTransactionInformation: true }));
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].memo).toContain('John Doe');
    expect(result.accounts![0].txns[0].memo).toContain('Transfer');
  });

  it('skips extra details when MC02ShowDetailsEZ is not 1', async () => {
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(mockApiResponse([scrapedTxn({ MC02ShowDetailsEZ: '0' })]));

    const scraper = new MizrahiScraper(createMockScraperOptions({ additionalTransactionInformation: true }));
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].memo).toBeUndefined();
  });

  it('handles extra details fetch error gracefully', async () => {
    (fetchPostWithinPage as jest.Mock)
      .mockResolvedValueOnce(mockApiResponse([scrapedTxn({ MC02ShowDetailsEZ: '1' })]))
      .mockResolvedValueOnce(null) // consumed by Promise.any url 2
      .mockRejectedValueOnce(new Error('Network error'));

    const scraper = new MizrahiScraper(createMockScraperOptions({ additionalTransactionInformation: true }));
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts![0].txns[0].memo).toBeUndefined();
  });

  it('returns undefined identifier when MC02AsmahtaMekoritEZ is empty', async () => {
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(
      mockApiResponse([scrapedTxn({ MC02AsmahtaMekoritEZ: '' })]),
    );

    const scraper = new MizrahiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].identifier).toBeUndefined();
  });

  it('uses integer identifier when TransactionNumber is 1', async () => {
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(
      mockApiResponse([scrapedTxn({ MC02AsmahtaMekoritEZ: '55555', TransactionNumber: '1' })]),
    );

    const scraper = new MizrahiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].identifier).toBe(55555);
  });

  it('filters transactions before start date', async () => {
    const oldDate = '2020-01-01T10:00:00';
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(
      mockApiResponse([scrapedTxn({ MC02PeulaTaaEZ: oldDate }), scrapedTxn()]),
    );

    const scraper = new MizrahiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns).toHaveLength(1);
  });

  it('includes rawTransaction with additionalInformation when details enabled', async () => {
    (fetchPostWithinPage as jest.Mock)
      .mockResolvedValueOnce(mockApiResponse([scrapedTxn({ MC02ShowDetailsEZ: '1' })]))
      .mockResolvedValueOnce(null) // consumed by Promise.any url 2
      .mockResolvedValueOnce(mockDetailsResponse([{ Label: 'חשבון', Value: '12345' }]));

    const scraper = new MizrahiScraper(
      createMockScraperOptions({ additionalTransactionInformation: true, includeRawTransaction: true }),
    );
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].rawTransaction).toBeDefined();
  });
});
