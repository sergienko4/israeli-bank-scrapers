import { jest } from '@jest/globals';
import type { Page } from 'playwright';

jest.unstable_mockModule('../../Common/ElementsInteractions.js', () => ({
  clickButton: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),

  fillInput: jest.fn().mockResolvedValue(undefined),

  elementPresentOnPage: jest.fn().mockResolvedValue(false),

  capturePageText: jest.fn().mockResolvedValue(''),
}));

jest.unstable_mockModule('../../Common/Waiting.js', () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
  humanDelay: jest.fn().mockResolvedValue(undefined),
  runSerial: jest.fn(),
  TimeoutError: class TimeoutError extends Error {},
  SECOND: 1000,
}));

jest.unstable_mockModule('../../Common/Debug.js', () => ({
  /**
   * Creates a mock debug logger.
   * @returns mock debug logger with all methods stubbed.
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
}));

const ACCOUNT_SELECTOR_MODULE =
  await import('../../Scrapers/Beinleumi/BeinleumiAccountSelector.js');
const MOCK_PAGE_MODULE = await import('../MockPage.js');

type MockPage = ReturnType<typeof MOCK_PAGE_MODULE.createMockPage>;
type MockLocator = ReturnType<typeof MOCK_PAGE_MODULE.createMockLocator>;

let mockPage: MockPage;
let dropdownLocator: MockLocator;
let optionLocator: MockLocator;

beforeEach(() => {
  jest.clearAllMocks();
  dropdownLocator = MOCK_PAGE_MODULE.createMockLocator();
  optionLocator = MOCK_PAGE_MODULE.createMockLocator();
  mockPage = MOCK_PAGE_MODULE.createMockPage({
    locator: jest.fn().mockImplementation((selector: string) => {
      if (selector === 'role=listbox') return dropdownLocator;
      if (selector === 'role=option') return optionLocator;
      return MOCK_PAGE_MODULE.createMockLocator();
    }),
  });
});

describe('clickAccountSelectorGetAccountIds', () => {
  it('returns account labels when dropdown is visible', async () => {
    dropdownLocator.evaluate.mockResolvedValueOnce(true);
    optionLocator.evaluateAll.mockResolvedValueOnce(['account-1', 'account-2']);

    const accounts = await ACCOUNT_SELECTOR_MODULE.clickAccountSelectorGetAccountIds(
      mockPage as unknown as Page,
    );
    expect(accounts).toEqual(['account-1', 'account-2']);
  });

  it('opens dropdown if not already open before reading options', async () => {
    dropdownLocator.evaluate.mockResolvedValueOnce(false);
    optionLocator.evaluateAll.mockResolvedValueOnce(['account-3']);

    const accounts = await ACCOUNT_SELECTOR_MODULE.clickAccountSelectorGetAccountIds(
      mockPage as unknown as Page,
    );
    expect(accounts).toEqual(['account-3']);
  });

  it('returns empty array when an error is thrown', async () => {
    dropdownLocator.evaluate.mockRejectedValueOnce(new Error('page crash'));

    const accounts = await ACCOUNT_SELECTOR_MODULE.clickAccountSelectorGetAccountIds(
      mockPage as unknown as Page,
    );
    expect(accounts).toEqual([]);
  });

  it('returns empty array when evaluateAll throws', async () => {
    dropdownLocator.evaluate.mockResolvedValueOnce(true);
    optionLocator.evaluateAll.mockRejectedValueOnce(new Error('no elements'));

    const accounts = await ACCOUNT_SELECTOR_MODULE.clickAccountSelectorGetAccountIds(
      mockPage as unknown as Page,
    );
    expect(accounts).toEqual([]);
  });
});

describe('getAccountIdsBothUIs', () => {
  it('returns new UI accounts when present', async () => {
    dropdownLocator.evaluate.mockResolvedValueOnce(true);
    optionLocator.evaluateAll.mockResolvedValueOnce(['111', '222']);

    const accounts = await ACCOUNT_SELECTOR_MODULE.getAccountIdsBothUIs(
      mockPage as unknown as Page,
    );
    expect(accounts).toEqual(['111', '222']);
  });

  it('falls back to old UI when new UI returns empty', async () => {
    dropdownLocator.evaluate.mockRejectedValueOnce(new Error('no selector'));
    mockPage.evaluate.mockResolvedValueOnce(['333']);

    const accounts = await ACCOUNT_SELECTOR_MODULE.getAccountIdsBothUIs(
      mockPage as unknown as Page,
    );
    expect(accounts).toEqual(['333']);
  });

  it('returns empty array when both UIs return nothing', async () => {
    dropdownLocator.evaluate.mockRejectedValueOnce(new Error('no selector'));
    mockPage.evaluate.mockResolvedValueOnce([]);

    const accounts = await ACCOUNT_SELECTOR_MODULE.getAccountIdsBothUIs(
      mockPage as unknown as Page,
    );
    expect(accounts).toEqual([]);
  });
});

describe('selectAccountFromDropdown', () => {
  it('returns false when account is not in available list', async () => {
    dropdownLocator.evaluate.mockResolvedValueOnce(true);
    optionLocator.evaluateAll.mockResolvedValueOnce(['acc-1', 'acc-2']);

    const isSelected = await ACCOUNT_SELECTOR_MODULE.selectAccountFromDropdown(
      mockPage as unknown as Page,
      'acc-99',
    );
    expect(isSelected).toBe(false);
  });

  it('returns true when account is found and clicked', async () => {
    dropdownLocator.evaluate.mockResolvedValueOnce(true);
    optionLocator.evaluateAll.mockResolvedValueOnce(['acc-1', 'acc-2']);

    const mockOptionEl = {
      evaluateHandle: jest.fn().mockResolvedValue({}),
    };
    mockPage.$$.mockResolvedValueOnce([mockOptionEl]);
    mockPage.evaluate.mockResolvedValueOnce('acc-1').mockResolvedValueOnce(undefined);

    const isSelected = await ACCOUNT_SELECTOR_MODULE.selectAccountFromDropdown(
      mockPage as unknown as Page,
      'acc-1',
    );
    expect(isSelected).toBe(true);
  });

  it('returns false when no matching option found in DOM', async () => {
    dropdownLocator.evaluate.mockResolvedValueOnce(true);
    optionLocator.evaluateAll.mockResolvedValueOnce(['acc-1']);

    const mockOptionEl = {
      evaluateHandle: jest.fn().mockResolvedValue({}),
    };
    mockPage.$$.mockResolvedValueOnce([mockOptionEl]);
    mockPage.evaluate.mockResolvedValueOnce('acc-different');

    const isSelected = await ACCOUNT_SELECTOR_MODULE.selectAccountFromDropdown(
      mockPage as unknown as Page,
      'acc-1',
    );
    expect(isSelected).toBe(false);
  });
});

describe('getTransactionsFrame', () => {
  it('returns undefined after all attempts fail', async () => {
    mockPage.frames.mockReturnValue([]);

    const frame = await ACCOUNT_SELECTOR_MODULE.getTransactionsFrame(mockPage as unknown as Page);
    expect(frame).toBeUndefined();
  });

  it('returns frame found via page.frames() by name', async () => {
    const mockFrame = { name: jest.fn().mockReturnValue('iframe-old-pages') };
    mockPage.frames.mockReturnValueOnce([mockFrame]);

    const frame = await ACCOUNT_SELECTOR_MODULE.getTransactionsFrame(mockPage as unknown as Page);
    expect(frame).toBe(mockFrame);
  });

  it('retries and returns frame on second attempt', async () => {
    const mockFrame = { name: jest.fn().mockReturnValue('iframe-old-pages') };
    mockPage.frames.mockReturnValueOnce([]).mockReturnValueOnce([mockFrame]);

    const frame = await ACCOUNT_SELECTOR_MODULE.getTransactionsFrame(mockPage as unknown as Page);
    expect(frame).toBe(mockFrame);
  });
});
