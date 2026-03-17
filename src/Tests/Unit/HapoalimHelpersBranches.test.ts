import { jest } from '@jest/globals';

const MOCK_FETCH_GET = jest.fn();
const MOCK_FETCH_POST = jest.fn();

jest.unstable_mockModule(
  '../../Common/CamoufoxLauncher.js',
  /**
   * Mocked CamoufoxLauncher factory.
   * @returns Mocked CamoufoxLauncher module.
   */
  () => ({ launchCamoufox: jest.fn() }),
);

jest.unstable_mockModule(
  '../../Common/Fetch.js',
  /**
   * Mocked Fetch factory.
   * @returns Mocked Fetch module.
   */
  () => ({ fetchGetWithinPage: MOCK_FETCH_GET, fetchPostWithinPage: MOCK_FETCH_POST }),
);

jest.unstable_mockModule(
  '../../Common/Browser.js',
  /**
   * Mocked Browser factory.
   * @returns Mocked Browser module.
   */
  () => ({ buildContextOptions: jest.fn().mockReturnValue({}) }),
);

jest.unstable_mockModule(
  '../../Common/Navigation.js',
  /**
   * Mocked Navigation factory.
   * @returns Mocked Navigation module.
   */
  () => ({
    getCurrentUrl: jest.fn().mockResolvedValue('https://bank.test/home'),
    waitForNavigation: jest.fn().mockResolvedValue(undefined),
    waitForRedirect: jest.fn().mockResolvedValue(undefined),
    waitForNavigationAndDomLoad: jest.fn().mockResolvedValue(undefined),
    waitForUrl: jest.fn().mockResolvedValue(undefined),
  }),
);

jest.unstable_mockModule(
  '../../Common/ElementsInteractions.js',
  /**
   * Mocked ElementsInteractions factory.
   * @returns Mocked ElementsInteractions module.
   */
  () => ({
    clickButton: jest.fn().mockResolvedValue(undefined),
    fillInput: jest.fn().mockResolvedValue(undefined),
    waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
    elementPresentOnPage: jest.fn().mockResolvedValue(false),
    capturePageText: jest.fn().mockResolvedValue(''),
  }),
);

jest.unstable_mockModule(
  '../../Common/Waiting.js',
  /**
   * Mocked Waiting factory.
   * @returns Mocked Waiting module.
   */
  () => ({
    waitUntil: jest.fn().mockResolvedValue(undefined),
    sleep: jest.fn().mockResolvedValue(undefined),
    humanDelay: jest.fn().mockResolvedValue(undefined),
    runSerial: jest.fn().mockResolvedValue([]),
    TimeoutError: class TimeoutError extends Error {},
    SECOND: 1000,
  }),
);

jest.unstable_mockModule(
  '../../Common/Debug.js',
  /**
   * Mocked Debug factory.
   * @returns Mocked Debug module.
   */
  () => ({
    /**
     * Creates a mock debug logger.
     * @returns Mock logger with all levels.
     */
    getDebug: (): Record<string, jest.Mock> => ({
      trace: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
    /**
     * Passthrough mock for bank context.
     * @param _b - Bank name (unused).
     * @param fn - Function to execute.
     * @returns fn result.
     */
    runWithBankContext: <T>(_b: string, fn: () => T): T => fn(),
  }),
);

const HELPERS = await import('../../Scrapers/Hapoalim/HapoalimHelpers.js');

/**
 * Creates a mock page for Hapoalim helpers tests.
 * @returns A mock page object.
 */
function makePage(): Record<string, jest.Mock> {
  return {
    evaluate: jest.fn().mockResolvedValue(''),
    context: jest.fn().mockReturnValue({
      /**
       * Cookie provider mock.
       * @returns Mock cookies array.
       */
      cookies: jest.fn().mockResolvedValue([{ name: 'XSRF-TOKEN', value: 'tok123' }]),
    }),
  };
}

describe('getAccountTransactions — buildMemo branches', () => {
  beforeEach(() => jest.clearAllMocks());

  it('converts transactions with full beneficiaryDetailsData memo', async () => {
    MOCK_FETCH_POST.mockResolvedValue({
      transactions: [
        {
          serialNumber: 1,
          activityDescription: 'Transfer',
          eventAmount: 500,
          eventDate: '2024-06-15',
          valueDate: '2024-06-15',
          referenceNumber: 123,
          eventActivityTypeCode: 1,
          currentBalance: 1000,
          pfmDetails: '',
          beneficiaryDetailsData: {
            partyHeadline: 'John',
            partyName: 'Doe',
            messageHeadline: 'Payment',
            messageDetail: 'Monthly',
          },
        },
      ],
    });

    const txns = await HELPERS.getAccountTransactions({
      baseUrl: 'https://api.test',
      apiSiteUrl: 'https://api.test',
      page: makePage() as never,
      accountNumber: '12-345-6789',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
    });

    expect(txns).toHaveLength(1);
    expect(txns[0].memo).toContain('John');
    expect(txns[0].memo).toContain('Doe.');
    expect(txns[0].memo).toContain('Payment');
    expect(txns[0].memo).toContain('Monthly.');
  });

  it('converts transactions with partial beneficiaryDetailsData', async () => {
    MOCK_FETCH_POST.mockResolvedValue({
      transactions: [
        {
          serialNumber: 1,
          activityDescription: 'Test',
          eventAmount: 100,
          eventDate: '2024-06-15',
          valueDate: '2024-06-15',
          referenceNumber: 456,
          eventActivityTypeCode: 2,
          currentBalance: 900,
          pfmDetails: '',
          beneficiaryDetailsData: { partyHeadline: 'Alice' },
        },
      ],
    });

    const txns = await HELPERS.getAccountTransactions({
      baseUrl: 'https://api.test',
      apiSiteUrl: 'https://api.test',
      page: makePage() as never,
      accountNumber: '12-345-6789',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
    });

    expect(txns).toHaveLength(1);
    expect(txns[0].memo).toBe('Alice');
    expect(txns[0].originalAmount).toBeLessThan(0);
  });

  it('converts transactions without beneficiaryDetailsData', async () => {
    MOCK_FETCH_POST.mockResolvedValue({
      transactions: [
        {
          serialNumber: 0,
          activityDescription: 'Pending',
          eventAmount: 200,
          eventDate: '2024-06-15',
          valueDate: '2024-06-15',
          eventActivityTypeCode: 1,
          currentBalance: 800,
          pfmDetails: '',
        },
      ],
    });

    const txns = await HELPERS.getAccountTransactions({
      baseUrl: 'https://api.test',
      apiSiteUrl: 'https://api.test',
      page: makePage() as never,
      accountNumber: '12-345-6789',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
    });

    expect(txns).toHaveLength(1);
    expect(txns[0].memo).toBe('');
    expect(txns[0].status).toBe('pending');
  });

  it('includes rawTransaction when option enabled', async () => {
    MOCK_FETCH_POST.mockResolvedValue({
      transactions: [
        {
          serialNumber: 1,
          activityDescription: 'Tx',
          eventAmount: 50,
          eventDate: '2024-06-15',
          valueDate: '2024-06-15',
          referenceNumber: 789,
          eventActivityTypeCode: 1,
          currentBalance: 750,
          pfmDetails: '',
        },
      ],
    });

    const txns = await HELPERS.getAccountTransactions({
      baseUrl: 'https://api.test',
      apiSiteUrl: 'https://api.test',
      page: makePage() as never,
      accountNumber: '12-345-6789',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      options: {
        companyId: 'hapoalim' as never,
        startDate: new Date(),
        includeRawTransaction: true,
      },
    });

    expect(txns).toHaveLength(1);
    expect(txns[0].rawTransaction).toBeDefined();
  });

  it('returns empty transactions when fetch returns null', async () => {
    MOCK_FETCH_POST.mockResolvedValue(null);

    const txns = await HELPERS.getAccountTransactions({
      baseUrl: 'https://api.test',
      apiSiteUrl: 'https://api.test',
      page: makePage() as never,
      accountNumber: '12-345-6789',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
    });

    expect(txns).toEqual([]);
  });
});

describe('fetchOpenAccounts — filtering branches', () => {
  beforeEach(() => jest.clearAllMocks());

  it('filters to only open accounts', async () => {
    MOCK_FETCH_GET.mockResolvedValue([
      { bankNumber: '12', branchNumber: '345', accountNumber: '111', accountClosingReasonCode: 0 },
      { bankNumber: '12', branchNumber: '345', accountNumber: '222', accountClosingReasonCode: 5 },
    ]);
    const page = makePage();
    const accounts = await HELPERS.fetchOpenAccounts(page as never, 'https://api.test');
    expect(accounts).toHaveLength(1);
    expect(accounts[0].accountNumber).toBe('111');
  });

  it('returns empty array when fetch returns null', async () => {
    MOCK_FETCH_GET.mockResolvedValue(null);
    const page = makePage();
    const accounts = await HELPERS.fetchOpenAccounts(page as never, 'https://api.test');
    expect(accounts).toEqual([]);
  });
});

describe('getAccountBalance — branches', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns balance value when data available', async () => {
    MOCK_FETCH_GET.mockResolvedValue({ currentBalance: 5000 });
    const page = makePage();
    const balanceResult = await HELPERS.getAccountBalance(
      'https://api.test',
      page as never,
      '12-345-6789',
    );
    expect(balanceResult.hasBalance).toBe(true);
    if (balanceResult.hasBalance) expect(balanceResult.value).toBe(5000);
  });

  it('returns no balance when fetch returns null', async () => {
    MOCK_FETCH_GET.mockResolvedValue(null);
    const page = makePage();
    const balanceResult = await HELPERS.getAccountBalance(
      'https://api.test',
      page as never,
      '12-345-6789',
    );
    expect(balanceResult.hasBalance).toBe(false);
  });
});

describe('fetchOneAccount — balance branches', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sets balance to undefined when no balance available', async () => {
    MOCK_FETCH_GET.mockResolvedValue(null);
    MOCK_FETCH_POST.mockResolvedValue({ transactions: [] });

    const result = await HELPERS.fetchOneAccount({
      page: makePage() as never,
      baseUrl: 'https://api.test',
      apiSiteUrl: 'https://api.test',
      account: {
        bankNumber: '12',
        branchNumber: '345',
        accountNumber: '111',
        accountClosingReasonCode: 0,
      },
      dateOpts: { startDateStr: '2024-01-01', endDateStr: '2024-12-31' },
      options: { companyId: 'hapoalim' as never, startDate: new Date() },
    });

    expect(result.balance).toBeUndefined();
  });
});
