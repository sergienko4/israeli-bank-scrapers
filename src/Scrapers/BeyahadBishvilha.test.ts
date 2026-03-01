import { chromium } from 'playwright';

import { buildContextOptions } from '../Helpers/Browser';
import { pageEval, pageEvalAll } from '../Helpers/ElementsInteractions';
import { filterOldTransactions } from '../Helpers/Transactions';
import { createMockPage, createMockScraperOptions } from '../Tests/MockPage';
import { TransactionStatuses, TransactionTypes } from '../Transactions';
import BeyahadBishvilhaScraper from './BeyahadBishvilha';

jest.mock('playwright', () => ({ chromium: { launch: jest.fn() } }));
jest.mock('../Helpers/ElementsInteractions', () => ({
  clickButton: jest.fn().mockResolvedValue(undefined),
  fillInput: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
  pageEval: jest.fn().mockResolvedValue(null),
  pageEvalAll: jest.fn().mockResolvedValue([]),
}));
jest.mock('../Helpers/Navigation', () => ({
  getCurrentUrl: jest.fn().mockResolvedValue('https://www.hist.org.il/'),
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../Helpers/Browser', () => ({
  buildContextOptions: jest.fn().mockReturnValue({}),
}));
jest.mock('../Helpers/Transactions', () => ({
  filterOldTransactions: jest.fn(<T>(txns: T[]) => txns),
  getRawTransaction: jest.fn((data: unknown) => data),
}));
jest.mock('../Helpers/Debug', () => ({ getDebug: () => jest.fn() }));

const mockContext = {
  newPage: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};
const mockBrowser = {
  newContext: jest.fn().mockResolvedValue(mockContext),
  close: jest.fn().mockResolvedValue(undefined),
};

const CREDS = { id: '123456789', password: 'pass123' };

function setupPage(): ReturnType<typeof createMockPage> {
  const page = createMockPage({
    $: jest.fn().mockResolvedValue({ click: jest.fn().mockResolvedValue(undefined) }),
  });
  mockContext.newPage.mockResolvedValue(page);
  return page;
}

beforeEach(() => {
  jest.clearAllMocks();
  (chromium.launch as jest.Mock).mockResolvedValue(mockBrowser);
  setupPage();
});

describe('login', () => {
  it('succeeds with valid credentials', async () => {
    (pageEval as jest.Mock)
      .mockResolvedValueOnce('1234567890') // accountNumber
      .mockResolvedValueOnce('₪5,000.00'); // balance
    (pageEvalAll as jest.Mock).mockResolvedValueOnce([]);

    const scraper = new BeyahadBishvilhaScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(buildContextOptions).toHaveBeenCalled();
  });
});

describe('fetchData', () => {
  it('extracts transactions from page', async () => {
    (pageEval as jest.Mock)
      .mockResolvedValueOnce('מספר כרטיס 12345') // accountNumber
      .mockResolvedValueOnce('₪5,000.00'); // balance

    (pageEvalAll as jest.Mock).mockResolvedValueOnce([
      {
        date: '15/06/24',
        identifier: 'TXN001',
        description: 'סופר שופ',
        type: 'רכישה',
        chargedAmount: '₪150.00',
      },
    ]);

    const scraper = new BeyahadBishvilhaScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts![0].txns).toHaveLength(1);

    const t = result.accounts![0].txns[0];
    expect(t.description).toBe('סופר שופ');
    expect(t.originalAmount).toBe(150);
    expect(t.originalCurrency).toBe('ILS');
    expect(t.status).toBe(TransactionStatuses.Completed);
    expect(t.type).toBe(TransactionTypes.Normal);
    expect(t.identifier).toBe('TXN001');
  });

  it('parses dollar amounts', async () => {
    (pageEval as jest.Mock).mockResolvedValueOnce('12345').mockResolvedValueOnce('$1,000.00');

    (pageEvalAll as jest.Mock).mockResolvedValueOnce([
      {
        date: '15/06/24',
        identifier: 'TXN002',
        description: 'Amazon',
        type: 'רכישה',
        chargedAmount: '$50.00',
      },
    ]);

    const scraper = new BeyahadBishvilhaScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].originalCurrency).toBe('USD');
    expect(result.accounts![0].txns[0].originalAmount).toBe(50);
  });

  it('parses euro amounts', async () => {
    (pageEval as jest.Mock).mockResolvedValueOnce('12345').mockResolvedValueOnce('€500.00');

    (pageEvalAll as jest.Mock).mockResolvedValueOnce([
      {
        date: '15/06/24',
        identifier: 'TXN003',
        description: 'Europe Shop',
        type: 'רכישה',
        chargedAmount: '€75.50',
      },
    ]);

    const scraper = new BeyahadBishvilhaScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].originalCurrency).toBe('EUR');
    expect(result.accounts![0].txns[0].originalAmount).toBe(75.5);
  });

  it('parses space-separated currency format', async () => {
    (pageEval as jest.Mock).mockResolvedValueOnce('12345').mockResolvedValueOnce('₪0');

    (pageEvalAll as jest.Mock).mockResolvedValueOnce([
      {
        date: '15/06/24',
        identifier: 'TXN004',
        description: 'GBP Payment',
        type: 'רכישה',
        chargedAmount: 'GBP 200.00',
      },
    ]);

    const scraper = new BeyahadBishvilhaScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].originalCurrency).toBe('GBP');
    expect(result.accounts![0].txns[0].originalAmount).toBe(200);
  });

  it('filters null transactions from DOM extraction', async () => {
    (pageEval as jest.Mock).mockResolvedValueOnce('12345').mockResolvedValueOnce('₪0');

    (pageEvalAll as jest.Mock).mockResolvedValueOnce([
      {
        date: '15/06/24',
        identifier: 'TXN001',
        description: 'Valid',
        type: 'רכישה',
        chargedAmount: '₪100.00',
      },
      null,
    ]);

    const scraper = new BeyahadBishvilhaScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns).toHaveLength(1);
  });

  it('calls filterOldTransactions when enabled', async () => {
    (pageEval as jest.Mock).mockResolvedValueOnce('12345').mockResolvedValueOnce('₪0');

    (pageEvalAll as jest.Mock).mockResolvedValueOnce([
      {
        date: '15/06/24',
        identifier: 'TXN001',
        description: 'Test',
        type: 'רכישה',
        chargedAmount: '₪100.00',
      },
    ]);

    const scraper = new BeyahadBishvilhaScraper(createMockScraperOptions());
    await scraper.scrape(CREDS);

    expect(filterOldTransactions).toHaveBeenCalled();
  });

  it('includes rawTransaction when option set', async () => {
    (pageEval as jest.Mock).mockResolvedValueOnce('12345').mockResolvedValueOnce('₪0');

    (pageEvalAll as jest.Mock).mockResolvedValueOnce([
      {
        date: '15/06/24',
        identifier: 'TXN001',
        description: 'Test',
        type: 'רכישה',
        chargedAmount: '₪100.00',
      },
    ]);

    const scraper = new BeyahadBishvilhaScraper(
      createMockScraperOptions({ includeRawTransaction: true }),
    );
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].rawTransaction).toBeDefined();
  });
});
