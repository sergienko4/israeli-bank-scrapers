import { jest } from '@jest/globals';
import type { Page } from 'playwright-core';

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

let mockPage: ReturnType<typeof MOCK_PAGE_MODULE.createMockPage>;

beforeEach(() => {
  jest.clearAllMocks();
  mockPage = MOCK_PAGE_MODULE.createMockPage();
});

describe('clickAccountSelectorGetAccountIds', () => {
  it('returns account labels when dropdown is visible', async () => {
    mockPage.$eval.mockResolvedValueOnce(true);
    mockPage.$$eval.mockResolvedValueOnce(['account-1', 'account-2']);

    const accounts = await ACCOUNT_SELECTOR_MODULE.clickAccountSelectorGetAccountIds(
      mockPage as unknown as Page,
    );
    expect(accounts).toEqual(['account-1', 'account-2']);
  });

  it('opens dropdown if not already open before reading options', async () => {
    mockPage.$eval.mockResolvedValueOnce(false);
    mockPage.$$eval.mockResolvedValueOnce(['account-3']);

    const accounts = await ACCOUNT_SELECTOR_MODULE.clickAccountSelectorGetAccountIds(
      mockPage as unknown as Page,
    );
    expect(accounts).toEqual(['account-3']);
  });

  it('returns empty array when an error is thrown', async () => {
    mockPage.$eval.mockRejectedValueOnce(new Error('page crash'));

    const accounts = await ACCOUNT_SELECTOR_MODULE.clickAccountSelectorGetAccountIds(
      mockPage as unknown as Page,
    );
    expect(accounts).toEqual([]);
  });

  it('returns empty array when $$eval throws', async () => {
    mockPage.$eval.mockResolvedValueOnce(true);
    mockPage.$$eval.mockRejectedValueOnce(new Error('no elements'));

    const accounts = await ACCOUNT_SELECTOR_MODULE.clickAccountSelectorGetAccountIds(
      mockPage as unknown as Page,
    );
    expect(accounts).toEqual([]);
  });
});

describe('getAccountIdsBothUIs', () => {
  it('returns new UI accounts when present', async () => {
    mockPage.$eval.mockResolvedValueOnce(true);
    mockPage.$$eval.mockResolvedValueOnce(['111', '222']);

    const accounts = await ACCOUNT_SELECTOR_MODULE.getAccountIdsBothUIs(
      mockPage as unknown as Page,
    );
    expect(accounts).toEqual(['111', '222']);
  });

  it('falls back to old UI when new UI returns empty', async () => {
    mockPage.$eval.mockRejectedValueOnce(new Error('no selector'));
    mockPage.evaluate.mockResolvedValueOnce(['333']);

    const accounts = await ACCOUNT_SELECTOR_MODULE.getAccountIdsBothUIs(
      mockPage as unknown as Page,
    );
    expect(accounts).toEqual(['333']);
  });

  it('returns empty array when both UIs return nothing', async () => {
    mockPage.$eval.mockRejectedValueOnce(new Error('no selector'));
    mockPage.evaluate.mockResolvedValueOnce([]);

    const accounts = await ACCOUNT_SELECTOR_MODULE.getAccountIdsBothUIs(
      mockPage as unknown as Page,
    );
    expect(accounts).toEqual([]);
  });
});

describe('selectAccountFromDropdown', () => {
  it('returns false when account is not in available list', async () => {
    mockPage.$eval.mockResolvedValueOnce(true);
    mockPage.$$eval.mockResolvedValueOnce(['acc-1', 'acc-2']);

    const isSelected = await ACCOUNT_SELECTOR_MODULE.selectAccountFromDropdown(
      mockPage as unknown as Page,
      'acc-99',
    );
    expect(isSelected).toBe(false);
  });

  it('returns true when account is found and clicked', async () => {
    mockPage.$eval.mockResolvedValueOnce(true);
    mockPage.$$eval.mockResolvedValueOnce(['acc-1', 'acc-2']);

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
    mockPage.$eval.mockResolvedValueOnce(true);
    mockPage.$$eval.mockResolvedValueOnce(['acc-1']);

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
  it('returns null after all attempts fail', async () => {
    mockPage.$.mockResolvedValue(null);
    mockPage.frames.mockReturnValue([]);

    const frame = await ACCOUNT_SELECTOR_MODULE.getTransactionsFrame(mockPage as unknown as Page);
    expect(frame).toBeUndefined();
  });

  it('returns frame found via iframe element contentFrame', async () => {
    const mockFrame = { name: jest.fn().mockReturnValue('') };
    const mockIframeEl = {
      contentFrame: jest.fn().mockResolvedValue(mockFrame),
    };
    mockPage.$.mockResolvedValueOnce(mockIframeEl);

    const frame = await ACCOUNT_SELECTOR_MODULE.getTransactionsFrame(mockPage as unknown as Page);
    expect(frame).toBe(mockFrame);
  });

  it('returns frame found via page.frames() by name', async () => {
    const mockFrame = { name: jest.fn().mockReturnValue('iframe-old-pages') };
    mockPage.$.mockResolvedValueOnce(null);
    mockPage.frames.mockReturnValueOnce([mockFrame]);

    const frame = await ACCOUNT_SELECTOR_MODULE.getTransactionsFrame(mockPage as unknown as Page);
    expect(frame).toBe(mockFrame);
  });

  it('retries and returns frame on second attempt', async () => {
    const mockFrame = { name: jest.fn().mockReturnValue('') };
    const mockIframeEl = {
      contentFrame: jest.fn().mockResolvedValue(mockFrame),
    };
    mockPage.$.mockResolvedValueOnce(null).mockResolvedValueOnce(mockIframeEl);
    mockPage.frames.mockReturnValue([]);

    const frame = await ACCOUNT_SELECTOR_MODULE.getTransactionsFrame(mockPage as unknown as Page);
    expect(frame).toBe(mockFrame);
  });

  it('handles stale iframe element (contentFrame throws)', async () => {
    const mockIframeEl = {
      contentFrame: jest.fn().mockRejectedValue(new Error('stale element')),
    };
    mockPage.$.mockResolvedValue(mockIframeEl);
    mockPage.frames.mockReturnValue([]);

    const frame = await ACCOUNT_SELECTOR_MODULE.getTransactionsFrame(mockPage as unknown as Page);
    expect(frame).toBeUndefined();
  });
});
