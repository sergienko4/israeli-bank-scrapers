/* eslint-disable @typescript-eslint/unbound-method */
import puppeteer from 'puppeteer';
import { SHEKEL_CURRENCY } from '../constants';
import { fetchPostWithinPage } from '../helpers/fetch';
import { elementPresentOnPage } from '../helpers/elements-interactions';
import { applyAntiDetection } from '../helpers/browser';
import { getCurrentUrl } from '../helpers/navigation';
import { createMockPage, createMockScraperOptions } from '../tests/mock-page';
import MizrahiScraper from './mizrahi';
import { TransactionStatuses, TransactionTypes } from '../transactions';

jest.mock('puppeteer', () => ({ launch: jest.fn() }));
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
  applyAntiDetection: jest.fn().mockResolvedValue(undefined),
  isBotDetectionScript: jest.fn(() => false),
  interceptionPriorities: { abort: 1000, continue: 10 },
}));
jest.mock('../helpers/transactions', () => ({
  getRawTransaction: jest.fn((data: any) => data),
}));
jest.mock('../helpers/debug', () => ({ getDebug: () => jest.fn() }));

const mockBrowser = {
  newPage: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};

const CREDS = { username: 'testuser', password: 'testpass' };

function scrapedTxn(overrides: any = {}): any {
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

function mockApiResponse(rows: any[] = [], balance = '5000') {
  return {
    header: { success: true, messages: [] },
    body: {
      fields: { Yitra: balance },
      table: { rows },
    },
  };
}

function createMizrahiPage() {
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
  (puppeteer.launch as jest.Mock).mockResolvedValue(mockBrowser);
  mockBrowser.newPage.mockResolvedValue(createMizrahiPage());
  (getCurrentUrl as jest.Mock).mockResolvedValue('https://mto.mizrahi-tefahot.co.il/OnlineApp/dashboard');
  (elementPresentOnPage as jest.Mock).mockResolvedValue(false);
});

describe('login', () => {
  it('succeeds with valid credentials', async () => {
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(mockApiResponse([scrapedTxn()]));

    const scraper = new MizrahiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(applyAntiDetection).toHaveBeenCalled();
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
    mockBrowser.newPage.mockResolvedValue(page);

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
});
