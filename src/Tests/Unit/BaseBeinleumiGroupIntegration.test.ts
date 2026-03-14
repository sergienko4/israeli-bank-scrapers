import { jest } from '@jest/globals';

import { type ScraperOptions } from '../../Scrapers/Base/Interface.js';
import {
  createBrowserMock,
  createCamoufoxMock,
  createDebugMock,
  createElementsMock,
  createNavigationMock,
  createOtpMock,
  createTransactionsMock,
  createWaitingMock,
} from '../MockModuleFactories.js';
import {
  BEINLEUMI_BASE_URL,
  BEINLEUMI_LOGIN_URL,
  BEINLEUMI_SUCCESS_URL,
  BEINLEUMI_TEST_BASE_URL,
  BEINLEUMI_TEST_TRANSACTIONS_URL,
} from '../TestConstants.js';

jest.unstable_mockModule('../../Common/CamoufoxLauncher.js', createCamoufoxMock);
jest.unstable_mockModule('../../Common/ElementsInteractions.js', createElementsMock);
jest.unstable_mockModule('../../Common/Navigation.js', () =>
  createNavigationMock(BEINLEUMI_SUCCESS_URL),
);
jest.unstable_mockModule('../../Common/Browser.js', createBrowserMock);
jest.unstable_mockModule('../../Common/Transactions.js', createTransactionsMock);
jest.unstable_mockModule('../../Common/Waiting.js', createWaitingMock);
jest.unstable_mockModule('../../Common/Debug.js', createDebugMock);
jest.unstable_mockModule('../../Common/OtpHandler.js', createOtpMock);
const { launchCamoufox: LAUNCH_CAMOUFOX } = await import('../../Common/CamoufoxLauncher.js');
const { elementPresentOnPage: ELEMENT_PRESENT, pageEvalAll: PAGE_EVAL_ALL } =
  await import('../../Common/ElementsInteractions.js');
const { getCurrentUrl: GET_CURRENT_URL } = await import('../../Common/Navigation.js');
const { ScraperErrorTypes: SCRAPER_ERROR_TYPES } = await import('../../Scrapers/Base/Errors.js');
const { default: BEINLEUMI_GROUP_BASE_SCRAPER } =
  await import('../../Scrapers/BaseBeinleumiGroup/BaseBeinleumiGroup.js');
const { beinleumiConfig: BEINLEUMI_CONFIG } =
  await import('../../Scrapers/BaseBeinleumiGroup/Config/BeinleumiLoginConfig.js');
const { ERROR_MESSAGE_CLASS } =
  await import('../../Scrapers/BaseBeinleumiGroup/BaseBeinleumiGroupHelpers.js');
const { createMockPage: CREATE_MOCK_PAGE, createMockScraperOptions: CREATE_OPTS } =
  await import('../MockPage.js');
const INTEGRATION = await import('../IntegrationHelpers.js');

/** Test scraper extending the Beinleumi group base. */
class TestBeinleumiScraper extends BEINLEUMI_GROUP_BASE_SCRAPER {
  public BASE_URL = BEINLEUMI_TEST_BASE_URL;
  public TRANSACTIONS_URL = BEINLEUMI_TEST_TRANSACTIONS_URL;
  /**
   * Create test Beinleumi scraper.
   * @param options - Scraper options.
   */
  constructor(options: ScraperOptions) {
    const config = BEINLEUMI_CONFIG(BEINLEUMI_BASE_URL);
    super(options, config);
  }
}
const MOCK_CONTEXT = { newPage: jest.fn(), close: jest.fn().mockResolvedValue(undefined) };
const MOCK_BROWSER = {
  newContext: jest.fn().mockResolvedValue(MOCK_CONTEXT),
  close: jest.fn().mockResolvedValue(undefined),
};
const CREDS = { username: 'testuser', password: 'testpass' };
// Column classes mirror real Beinleumi HTML: 'reference wrap_normal' holds description text,
// 'details' holds the numeric reference — names are confusing but match production DOM.
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
  if (selector === `.${ERROR_MESSAGE_CLASS}`)
    return '\u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0\u05D5 \u05E0\u05EA\u05D5\u05E0\u05D9\u05DD \u05D1\u05E0\u05D5\u05E9\u05D0 \u05D4\u05DE\u05D1\u05D5\u05E7\u05E9';
  return '';
}
/** Default page mock methods for Beinleumi tests. */
const DEFAULT_PAGE_MOCKS = {
  $$eval: jest.fn().mockResolvedValue([]),
  evaluate: jest.fn().mockResolvedValue([]),
  frames: jest.fn().mockReturnValue([]),
};

/**
 * Create a page mock with standard account selectors.
 * @param overrides - Mock overrides for the page.
 * @returns Mocked page.
 */
function createPage(
  overrides: Record<string, jest.Mock> = {},
): ReturnType<typeof CREATE_MOCK_PAGE> {
  const evalMock = jest.fn().mockImplementation(evalBySelector);
  return CREATE_MOCK_PAGE({ $eval: evalMock, ...DEFAULT_PAGE_MOCKS, ...overrides });
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
  (GET_CURRENT_URL as jest.Mock).mockResolvedValue(BEINLEUMI_SUCCESS_URL);
});
describe('integration: full scrape flow', () => {
  it('happy path: completed transactions table yields success with account and amounts', async () => {
    mockTxnTable([
      { innerTds: ['10/06/2024', '5001', 'Salary', '', '\u20AA3,200.00'] },
      { innerTds: ['12/06/2024', '5002', 'Rent', '\u20AA1,800.00', ''] },
    ]);
    const result = await new TestBeinleumiScraper(CREATE_OPTS()).scrape(CREDS);
    const accounts = INTEGRATION.assertSuccess(result, 1);
    expect(accounts[0]?.accountNumber).toBe('12_345678');
    expect(accounts[0]?.txns).toHaveLength(2);
    expect(accounts[0]?.txns[0]?.originalAmount).toBe(3200);
    expect(accounts[0]?.txns[1]?.originalAmount).toBe(-1800);
  });
  it('invalid login: marketing URL returns InvalidPassword error', async () => {
    (GET_CURRENT_URL as jest.Mock).mockResolvedValue(BEINLEUMI_LOGIN_URL);
    const result = await new TestBeinleumiScraper(CREATE_OPTS()).scrape(CREDS);
    INTEGRATION.assertFailure(result, SCRAPER_ERROR_TYPES.InvalidPassword);
  });
  it('no data: elementPresentOnPage for NO_DATA returns success with 0 txns', async () => {
    (ELEMENT_PRESENT as jest.Mock).mockImplementation(
      (_page: ReturnType<typeof CREATE_MOCK_PAGE>, selector: string): boolean =>
        selector === `.${ERROR_MESSAGE_CLASS}`,
    );
    const result = await new TestBeinleumiScraper(CREATE_OPTS()).scrape(CREDS);
    INTEGRATION.assertEmptyTxns(result);
    expect(result.accounts).toBeDefined();
    expect(result.accounts?.length).toBeGreaterThanOrEqual(1);
  });
});
