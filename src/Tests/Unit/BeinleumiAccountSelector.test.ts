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

/**
 * Build a locator mock for the dropdown panel visibility check.
 * @param isVis - Whether the panel should appear visible.
 * @returns Mock locator chain.
 */
function makeDropdownLocator(isVis: boolean): { first: jest.Mock; isVisible: jest.Mock } {
  const loc = {
    first: jest.fn(),
    isVisible: jest.fn().mockResolvedValue(isVis),
  };
  loc.first.mockReturnValue(loc);
  return loc;
}

/**
 * Build a locator mock that returns allInnerTexts for option labels.
 * @param labels - The labels to return from allInnerTexts.
 * @returns Mock locator with allInnerTexts.
 */
function makeOptionLocator(labels: string[]): {
  allInnerTexts: jest.Mock;
  all: jest.Mock;
  count: jest.Mock;
} {
  return {
    allInnerTexts: jest.fn().mockResolvedValue(labels),
    all: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(labels.length),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPage = MOCK_PAGE_MODULE.createMockPage();
});

describe('clickAccountSelectorGetAccountIds', () => {
  it('returns account labels when dropdown is visible', async () => {
    const dropdownLoc = makeDropdownLocator(true);
    const optionLoc = makeOptionLocator(['account-1', 'account-2']);
    mockPage.locator = jest.fn().mockImplementation((sel: string) => {
      if (sel.includes('autocomplete')) return dropdownLoc;
      return optionLoc;
    });

    const accounts = await ACCOUNT_SELECTOR_MODULE.clickAccountSelectorGetAccountIds(
      mockPage as unknown as Page,
    );
    expect(accounts).toEqual(['account-1', 'account-2']);
  });

  it('opens dropdown if not already open before reading options', async () => {
    const dropdownLoc = makeDropdownLocator(false);
    const optionLoc = makeOptionLocator(['account-3']);
    mockPage.locator = jest.fn().mockImplementation((sel: string) => {
      if (sel.includes('autocomplete')) return dropdownLoc;
      return optionLoc;
    });

    const accounts = await ACCOUNT_SELECTOR_MODULE.clickAccountSelectorGetAccountIds(
      mockPage as unknown as Page,
    );
    expect(accounts).toEqual(['account-3']);
  });

  it('returns empty array when an error is thrown', async () => {
    const dropdownLoc = makeDropdownLocator(false);
    dropdownLoc.isVisible.mockRejectedValueOnce(new Error('page crash'));
    mockPage.locator = jest.fn().mockReturnValue(dropdownLoc);

    const accounts = await ACCOUNT_SELECTOR_MODULE.clickAccountSelectorGetAccountIds(
      mockPage as unknown as Page,
    );
    expect(accounts).toEqual([]);
  });

  it('returns empty array when allInnerTexts throws', async () => {
    const dropdownLoc = makeDropdownLocator(true);
    const brokenOptionLoc = {
      allInnerTexts: jest.fn().mockRejectedValue(new Error('no elements')),
    };
    mockPage.locator = jest.fn().mockImplementation((sel: string) => {
      if (sel.includes('autocomplete')) return dropdownLoc;
      return brokenOptionLoc;
    });

    const accounts = await ACCOUNT_SELECTOR_MODULE.clickAccountSelectorGetAccountIds(
      mockPage as unknown as Page,
    );
    expect(accounts).toEqual([]);
  });
});

describe('getAccountIdsBothUIs', () => {
  it('returns new UI accounts when present', async () => {
    const dropdownLoc = makeDropdownLocator(true);
    const optionLoc = makeOptionLocator(['111', '222']);
    mockPage.locator = jest.fn().mockImplementation((sel: string) => {
      if (sel.includes('autocomplete')) return dropdownLoc;
      return optionLoc;
    });

    const accounts = await ACCOUNT_SELECTOR_MODULE.getAccountIdsBothUIs(
      mockPage as unknown as Page,
    );
    expect(accounts).toEqual(['111', '222']);
  });

  it('falls back to old UI when new UI returns empty', async () => {
    const dropdownLoc = makeDropdownLocator(false);
    dropdownLoc.isVisible.mockRejectedValueOnce(new Error('no selector'));
    const optVal = { getAttribute: jest.fn().mockResolvedValue('333') };
    const legacyLoc = { all: jest.fn().mockResolvedValue([optVal]) };
    mockPage.locator = jest.fn().mockImplementation((sel: string) => {
      if (sel.includes('autocomplete')) return dropdownLoc;
      if (sel.includes('account_num_select')) return legacyLoc;
      return dropdownLoc;
    });

    const accounts = await ACCOUNT_SELECTOR_MODULE.getAccountIdsBothUIs(
      mockPage as unknown as Page,
    );
    expect(accounts).toEqual(['333']);
  });

  it('returns empty array when both UIs return nothing', async () => {
    const dropdownLoc = makeDropdownLocator(false);
    dropdownLoc.isVisible.mockRejectedValueOnce(new Error('no selector'));
    const emptyLoc = { all: jest.fn().mockResolvedValue([]) };
    mockPage.locator = jest.fn().mockImplementation((sel: string) => {
      if (sel.includes('autocomplete')) return dropdownLoc;
      if (sel.includes('account_num_select')) return emptyLoc;
      return dropdownLoc;
    });

    const accounts = await ACCOUNT_SELECTOR_MODULE.getAccountIdsBothUIs(
      mockPage as unknown as Page,
    );
    expect(accounts).toEqual([]);
  });
});

describe('selectAccountFromDropdown', () => {
  it('returns false when account is not in available list', async () => {
    const dropdownLoc = makeDropdownLocator(true);
    const optionLoc = makeOptionLocator(['acc-1', 'acc-2']);
    mockPage.locator = jest.fn().mockImplementation((sel: string) => {
      if (sel.includes('autocomplete')) return dropdownLoc;
      return optionLoc;
    });

    const isSelected = await ACCOUNT_SELECTOR_MODULE.selectAccountFromDropdown(
      mockPage as unknown as Page,
      'acc-99',
    );
    expect(isSelected).toBe(false);
  });

  it('returns true when account is found and clicked', async () => {
    const dropdownLoc = makeDropdownLocator(true);
    const optionLoc = makeOptionLocator(['acc-1', 'acc-2']);
    const clickableOption = {
      innerText: jest.fn().mockResolvedValue('acc-1'),
      click: jest.fn().mockResolvedValue(undefined),
    };
    const optionLocAll = {
      ...optionLoc,
      all: jest.fn().mockResolvedValue([clickableOption]),
    };
    mockPage.locator = jest.fn().mockImplementation((sel: string) => {
      if (sel.includes('autocomplete')) return dropdownLoc;
      return optionLocAll;
    });

    const isSelected = await ACCOUNT_SELECTOR_MODULE.selectAccountFromDropdown(
      mockPage as unknown as Page,
      'acc-1',
    );
    expect(isSelected).toBe(true);
    expect(clickableOption.click).toHaveBeenCalled();
  });

  it('returns false when no matching option found in DOM', async () => {
    const dropdownLoc = makeDropdownLocator(true);
    const optionLoc = makeOptionLocator(['acc-1']);
    const nonMatchOption = {
      innerText: jest.fn().mockResolvedValue('acc-different'),
      click: jest.fn().mockResolvedValue(undefined),
    };
    const optionLocAll = {
      ...optionLoc,
      all: jest.fn().mockResolvedValue([nonMatchOption]),
    };
    mockPage.locator = jest.fn().mockImplementation((sel: string) => {
      if (sel.includes('autocomplete')) return dropdownLoc;
      return optionLocAll;
    });

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
    mockPage.frames.mockReturnValue([mockFrame]);

    const frame = await ACCOUNT_SELECTOR_MODULE.getTransactionsFrame(mockPage as unknown as Page);
    expect(frame).toBe(mockFrame);
  });

  it('retries and returns frame on second attempt', async () => {
    const mockFrame = { name: jest.fn().mockReturnValue('iframe-old-pages') };
    mockPage.frames.mockReturnValueOnce([]).mockReturnValueOnce([mockFrame]);

    const frame = await ACCOUNT_SELECTOR_MODULE.getTransactionsFrame(mockPage as unknown as Page);
    expect(frame).toBe(mockFrame);
  });

  it('returns undefined when frames have wrong names', async () => {
    const wrongFrame = { name: jest.fn().mockReturnValue('some-other-frame') };
    mockPage.frames.mockReturnValue([wrongFrame]);

    const frame = await ACCOUNT_SELECTOR_MODULE.getTransactionsFrame(mockPage as unknown as Page);
    expect(frame).toBeUndefined();
  });
});
