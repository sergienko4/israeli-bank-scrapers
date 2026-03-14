import { jest } from '@jest/globals';

import { type ScraperOptions } from '../../Scrapers/Base/Interface.js';

/**
 * Create a mock that resolves to the given value.
 * @param v - The value to resolve.
 * @returns Mocked function.
 */
const MOCK_RESOLVED = (v?: unknown): jest.Mock => jest.fn().mockResolvedValue(v);
/**
 * Create a mock logger with all levels.
 * @returns Mock logger with trace/debug/info/warn/error.
 */
const MOCK_LOGGER = (): Record<string, jest.Mock> => ({
  trace: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});
jest.unstable_mockModule('../../Common/CamoufoxLauncher.js', () => ({ launchCamoufox: jest.fn() }));
jest.unstable_mockModule('../../Common/ElementsInteractions.js', () => ({
  clickButton: MOCK_RESOLVED(),
  fillInput: MOCK_RESOLVED(),
  waitUntilElementFound: MOCK_RESOLVED(),
  elementPresentOnPage: jest.fn().mockResolvedValue(false),
  pageEvalAll: jest.fn().mockResolvedValue([]),
  pageEval: jest.fn().mockResolvedValue(null),
  capturePageText: jest.fn().mockResolvedValue(''),
}));
jest.unstable_mockModule('../../Common/Navigation.js', () => ({
  waitForNavigation: MOCK_RESOLVED(),
  getCurrentUrl: jest.fn().mockResolvedValue('https://test.fibi.co.il/Resources/PortalNG/shell'),
  waitForNavigationAndDomLoad: MOCK_RESOLVED(),
  waitForRedirect: MOCK_RESOLVED(),
  waitForUrl: MOCK_RESOLVED(),
}));
jest.unstable_mockModule('../../Common/Browser.js', () => ({
  buildContextOptions: jest.fn().mockReturnValue({}),
}));
jest.unstable_mockModule('../../Common/Transactions.js', () => ({
  getRawTransaction: jest.fn((data: Record<string, number>): Record<string, number> => data),
}));
jest.unstable_mockModule('../../Common/Waiting.js', () => ({
  sleep: MOCK_RESOLVED(),
  humanDelay: MOCK_RESOLVED(),
  runSerial: jest.fn(<T>(actions: (() => Promise<T>)[]): Promise<T[]> => {
    const seed = Promise.resolve([] as T[]);
    return actions.reduce(
      (p: Promise<T[]>, act: () => Promise<T>) => p.then(async (r: T[]) => [...r, await act()]),
      seed,
    );
  }),
  waitUntil: MOCK_RESOLVED(),
  raceTimeout: MOCK_RESOLVED(),
  TimeoutError: Error,
  SECOND: 1000,
}));
jest.unstable_mockModule('../../Common/Debug.js', () => ({
  getDebug: MOCK_LOGGER,
  /**
   * Passthrough mock for bank context.
   * @param _b - Bank name (unused).
   * @param fn - Function to execute.
   * @returns fn result.
   */
  runWithBankContext: <T>(_b: string, fn: () => T): T => fn(),
}));
jest.unstable_mockModule('../../Common/OtpHandler.js', () => ({
  handleOtpStep: jest.fn().mockResolvedValue(null),
  handleOtpCode: jest.fn().mockResolvedValue({ success: true }),
  handleOtpConfirm: MOCK_RESOLVED(''),
}));
const { launchCamoufox: LAUNCH_CAMOUFOX } = await import('../../Common/CamoufoxLauncher.js');
const { elementPresentOnPage: ELEMENT_PRESENT, pageEvalAll: PAGE_EVAL_ALL } =
  await import('../../Common/ElementsInteractions.js');
const { getCurrentUrl: GET_CURRENT_URL } = await import('../../Common/Navigation.js');
const { ScraperErrorTypes: SCRAPER_ERROR_TYPES } = await import('../../Scrapers/Base/Errors.js');
const { default: BEINLEUMI_GROUP_BASE_SCRAPER } =
  await import('../../Scrapers/BaseBeinleumiGroup/BaseBeinleumiGroup.js');
const { beinleumiConfig: BEINLEUMI_CONFIG } =
  await import('../../Scrapers/BaseBeinleumiGroup/Config/BeinleumiLoginConfig.js');
const { createMockPage: CREATE_MOCK_PAGE, createMockScraperOptions: CREATE_OPTS } =
  await import('../MockPage.js');
const INTEGRATION = await import('../IntegrationHelpers.js');

/** Test scraper extending the Beinleumi group base. */
class TestBeinleumiScraper extends BEINLEUMI_GROUP_BASE_SCRAPER {
  public BASE_URL = 'https://test.fibi.co.il';
  public TRANSACTIONS_URL = 'https://test.fibi.co.il/transactions';
  /**
   * Create test Beinleumi scraper.
   * @param options - Scraper options.
   */
  constructor(options: ScraperOptions) {
    const config = BEINLEUMI_CONFIG('https://www.fibi.co.il');
    super(options, config);
  }
}
const MOCK_CONTEXT = { newPage: jest.fn(), close: jest.fn().mockResolvedValue(undefined) };
const MOCK_BROWSER = {
  newContext: jest.fn().mockResolvedValue(MOCK_CONTEXT),
  close: jest.fn().mockResolvedValue(undefined),
};
const CREDS = { username: 'testuser', password: 'testpass' };
const COMPLETED_COL = [
  { colClass: 'date first', index: 0 },
  { colClass: 'reference wrap_normal', index: 1 },
  { colClass: 'details', index: 2 },
  { colClass: 'debit', index: 3 },
  { colClass: 'credit', index: 4 },
];

/**
 * Mock $eval to return account number, balance, or no-data text based on selector.
 * @param selector - CSS selector string.
 * @returns Mocked inner text for the matched element.
 */
function evalBySelector(selector: string): string {
  if (selector === 'div.fibi_account span.acc_num') return '12/345678';
  if (selector === '.main_balance') return '\u20AA5,000.00';
  if (selector === '.NO_DATA')
    return '\u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0\u05D5 \u05E0\u05EA\u05D5\u05E0\u05D9\u05DD \u05D1\u05E0\u05D5\u05E9\u05D0 \u05D4\u05DE\u05D1\u05D5\u05E7\u05E9';
  return '';
}
/**
 * Create a page mock with standard account selectors.
 * @param overrides - Mock overrides for the page.
 * @returns Mocked page.
 */
function createPage(
  overrides: Record<string, jest.Mock> = {},
): ReturnType<typeof CREATE_MOCK_PAGE> {
  return CREATE_MOCK_PAGE({
    $eval: jest.fn().mockImplementation(evalBySelector),
    $$eval: jest.fn().mockResolvedValue([]),
    evaluate: jest.fn().mockResolvedValue([]),
    frames: jest.fn().mockReturnValue([]),
    ...overrides,
  });
}

/**
 * Set up pageEvalAll to return standard completed transaction table data.
 * @param rows - Transaction row data.
 * @returns True when setup complete.
 */
function mockTxnTable(rows: { innerTds: string[] }[]): boolean {
  (PAGE_EVAL_ALL as jest.Mock)
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce(COMPLETED_COL)
    .mockResolvedValueOnce(rows);
  return true;
}
beforeEach(() => {
  jest.clearAllMocks();
  (PAGE_EVAL_ALL as jest.Mock).mockReset().mockResolvedValue([]);
  (ELEMENT_PRESENT as jest.Mock).mockReset().mockResolvedValue(false);
  (LAUNCH_CAMOUFOX as jest.Mock).mockResolvedValue(MOCK_BROWSER);
  const defaultPage = createPage();
  MOCK_CONTEXT.newPage.mockResolvedValue(defaultPage);
  (GET_CURRENT_URL as jest.Mock).mockResolvedValue(
    'https://test.fibi.co.il/Resources/PortalNG/shell',
  );
});
describe('integration: full scrape flow', () => {
  it('happy path: completed transactions table yields success with account and amounts', async () => {
    mockTxnTable([
      { innerTds: ['10/06/2024', 'Salary', '5001', '', '\u20AA3,200.00'] },
      { innerTds: ['12/06/2024', 'Rent', '5002', '\u20AA1,800.00', ''] },
    ]);
    const result = await new TestBeinleumiScraper(CREATE_OPTS()).scrape(CREDS);
    const accounts = INTEGRATION.assertSuccess(result, 1);
    expect(accounts[0]?.accountNumber).toBe('12_345678');
    expect(accounts[0]?.txns).toHaveLength(2);
    expect(accounts[0]?.txns[0]?.originalAmount).toBe(3200);
    expect(accounts[0]?.txns[1]?.originalAmount).toBe(-1800);
  });
  it('invalid login: marketing URL returns InvalidPassword error', async () => {
    (GET_CURRENT_URL as jest.Mock).mockResolvedValue(
      'https://test.fibi.co.il/FibiMenu/Marketing/Private/Home',
    );
    const result = await new TestBeinleumiScraper(CREATE_OPTS()).scrape(CREDS);
    INTEGRATION.assertFailure(result, SCRAPER_ERROR_TYPES.InvalidPassword);
  });
  it('no data: elementPresentOnPage for NO_DATA returns success with 0 txns', async () => {
    (ELEMENT_PRESENT as jest.Mock).mockImplementation(
      (_page: ReturnType<typeof CREATE_MOCK_PAGE>, selector: string): boolean =>
        selector === '.NO_DATA',
    );
    const result = await new TestBeinleumiScraper(CREATE_OPTS()).scrape(CREDS);
    INTEGRATION.assertEmptyTxns(result);
  });
});
