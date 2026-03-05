import { type Page } from 'playwright';

import {
  clickAccountSelectorGetAccountIds,
  getAccountIdsBothUIs,
  getTransactionsFrame,
  selectAccountFromDropdown,
} from '../../Scrapers/Beinleumi/BeinleumiAccountSelector';
import { createMockPage } from '../MockPage';

jest.mock('../../Common/ElementsInteractions', () => ({
  clickButton: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../Common/Waiting', () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
  humanDelay: jest.fn().mockResolvedValue(undefined),
  runSerial: jest.fn(),
  TimeoutError: class TimeoutError extends Error {},
  SECOND: 1000,
}));

jest.mock('../../Common/Debug', () => ({
  getDebug: (): Record<string, jest.Mock> => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

let mockPage: ReturnType<typeof createMockPage>;

beforeEach(() => {
  jest.clearAllMocks();
  mockPage = createMockPage();
});

describe('clickAccountSelectorGetAccountIds', () => {
  it('returns account labels when dropdown is visible', async () => {
    mockPage.$eval.mockResolvedValueOnce(true);
    mockPage.$$eval.mockResolvedValueOnce(['account-1', 'account-2']);

    const result = await clickAccountSelectorGetAccountIds(mockPage as unknown as Page);
    expect(result).toEqual(['account-1', 'account-2']);
  });

  it('opens dropdown if not already open before reading options', async () => {
    mockPage.$eval.mockResolvedValueOnce(false);
    mockPage.$$eval.mockResolvedValueOnce(['account-3']);

    const result = await clickAccountSelectorGetAccountIds(mockPage as unknown as Page);
    expect(result).toEqual(['account-3']);
  });

  it('returns empty array when an error is thrown', async () => {
    mockPage.$eval.mockRejectedValueOnce(new Error('page crash'));

    const result = await clickAccountSelectorGetAccountIds(mockPage as unknown as Page);
    expect(result).toEqual([]);
  });

  it('returns empty array when $$eval throws', async () => {
    mockPage.$eval.mockResolvedValueOnce(true);
    mockPage.$$eval.mockRejectedValueOnce(new Error('no elements'));

    const result = await clickAccountSelectorGetAccountIds(mockPage as unknown as Page);
    expect(result).toEqual([]);
  });
});

describe('getAccountIdsBothUIs', () => {
  it('returns new UI accounts when present', async () => {
    mockPage.$eval.mockResolvedValueOnce(true);
    mockPage.$$eval.mockResolvedValueOnce(['111', '222']);

    const result = await getAccountIdsBothUIs(mockPage as unknown as Page);
    expect(result).toEqual(['111', '222']);
  });

  it('falls back to old UI when new UI returns empty', async () => {
    mockPage.$eval.mockRejectedValueOnce(new Error('no selector'));
    mockPage.evaluate.mockResolvedValueOnce(['333']);

    const result = await getAccountIdsBothUIs(mockPage as unknown as Page);
    expect(result).toEqual(['333']);
  });

  it('returns empty array when both UIs return nothing', async () => {
    mockPage.$eval.mockRejectedValueOnce(new Error('no selector'));
    mockPage.evaluate.mockResolvedValueOnce([]);

    const result = await getAccountIdsBothUIs(mockPage as unknown as Page);
    expect(result).toEqual([]);
  });
});

describe('selectAccountFromDropdown', () => {
  it('returns false when account is not in available list', async () => {
    mockPage.$eval.mockResolvedValueOnce(true);
    mockPage.$$eval.mockResolvedValueOnce(['acc-1', 'acc-2']);

    const wasSelected = await selectAccountFromDropdown(mockPage as unknown as Page, 'acc-99');
    expect(wasSelected).toBe(false);
  });

  it('returns true when account is found and clicked', async () => {
    mockPage.$eval.mockResolvedValueOnce(true);
    mockPage.$$eval.mockResolvedValueOnce(['acc-1', 'acc-2']);

    const mockOptionEl = {
      evaluateHandle: jest.fn().mockResolvedValue({}),
    };
    mockPage.$$.mockResolvedValueOnce([mockOptionEl]);
    mockPage.evaluate.mockResolvedValueOnce('acc-1').mockResolvedValueOnce(undefined);

    const wasSelected = await selectAccountFromDropdown(mockPage as unknown as Page, 'acc-1');
    expect(wasSelected).toBe(true);
  });

  it('returns false when no matching option found in DOM', async () => {
    mockPage.$eval.mockResolvedValueOnce(true);
    mockPage.$$eval.mockResolvedValueOnce(['acc-1']);

    const mockOptionEl = {
      evaluateHandle: jest.fn().mockResolvedValue({}),
    };
    mockPage.$$.mockResolvedValueOnce([mockOptionEl]);
    mockPage.evaluate.mockResolvedValueOnce('acc-different');

    const wasSelected = await selectAccountFromDropdown(mockPage as unknown as Page, 'acc-1');
    expect(wasSelected).toBe(false);
  });
});

describe('getTransactionsFrame', () => {
  it('returns null after all attempts fail', async () => {
    mockPage.$.mockResolvedValue(null);
    mockPage.frames.mockReturnValue([]);

    const result = await getTransactionsFrame(mockPage as unknown as Page);
    expect(result).toBeNull();
  });

  it('returns frame found via iframe element contentFrame', async () => {
    const mockFrame = { name: jest.fn().mockReturnValue('') };
    const mockIframeEl = {
      contentFrame: jest.fn().mockResolvedValue(mockFrame),
    };
    mockPage.$.mockResolvedValueOnce(mockIframeEl);

    const result = await getTransactionsFrame(mockPage as unknown as Page);
    expect(result).toBe(mockFrame);
  });

  it('returns frame found via page.frames() by name', async () => {
    const mockFrame = { name: jest.fn().mockReturnValue('iframe-old-pages') };
    mockPage.$.mockResolvedValueOnce(null);
    mockPage.frames.mockReturnValueOnce([mockFrame]);

    const result = await getTransactionsFrame(mockPage as unknown as Page);
    expect(result).toBe(mockFrame);
  });

  it('retries and returns frame on second attempt', async () => {
    const mockFrame = { name: jest.fn().mockReturnValue('') };
    const mockIframeEl = {
      contentFrame: jest.fn().mockResolvedValue(mockFrame),
    };
    mockPage.$.mockResolvedValueOnce(null).mockResolvedValueOnce(mockIframeEl);
    mockPage.frames.mockReturnValue([]);

    const result = await getTransactionsFrame(mockPage as unknown as Page);
    expect(result).toBe(mockFrame);
  });

  it('handles stale iframe element (contentFrame throws)', async () => {
    const mockIframeEl = {
      contentFrame: jest.fn().mockRejectedValue(new Error('stale element')),
    };
    mockPage.$.mockResolvedValue(mockIframeEl);
    mockPage.frames.mockReturnValue([]);

    const result = await getTransactionsFrame(mockPage as unknown as Page);
    expect(result).toBeNull();
  });
});
