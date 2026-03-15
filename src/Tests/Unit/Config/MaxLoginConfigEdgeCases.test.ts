import { jest } from '@jest/globals';
import type { Page } from 'playwright-core';

const MOCK_ELEMENT_PRESENT = jest.fn().mockResolvedValue(false);

jest.unstable_mockModule(
  '../../../Common/Debug.js',
  /**
   * Mock Debug module.
   * @returns mocked debug exports
   */
  () => ({
    getDebug:
      /**
       * Debug factory.
       * @returns mock logger
       */
      (): Record<string, jest.Mock> => ({
        trace: jest.fn(),
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }),
  }),
);

jest.unstable_mockModule('../../../Common/Waiting.js', () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
  humanDelay: jest.fn().mockResolvedValue(undefined),
  waitUntil: jest.fn().mockResolvedValue(undefined),
  raceTimeout: jest.fn().mockResolvedValue(undefined),
  /**
   * Executes async actions sequentially, collecting results.
   * @param actions - Array of async factory functions.
   * @returns Array of resolved values.
   */
  runSerial: jest.fn().mockImplementation(<T>(actions: (() => Promise<T>)[]): Promise<T[]> => {
    const seed = Promise.resolve([] as T[]);
    return actions.reduce(
      (p: Promise<T[]>, act: () => Promise<T>) => p.then(async (r: T[]) => [...r, await act()]),
      seed,
    );
  }),
  TimeoutError: Error,
  SECOND: 1000,
}));

jest.unstable_mockModule('../../../Common/ElementsInteractions.js', () => ({
  fillInput: jest.fn().mockResolvedValue(undefined),
  clickButton: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
  elementPresentOnPage: MOCK_ELEMENT_PRESENT,
  capturePageText: jest.fn().mockResolvedValue(''),
}));

jest.unstable_mockModule('../../../Common/SelectorResolver.js', () => ({
  resolveFieldWithCache: jest
    .fn()
    .mockResolvedValue({ isResolved: false, selector: '', context: {} }),
  resolveFieldContext: jest.fn().mockResolvedValue({ isResolved: false }),
  candidateToCss: jest.fn((c: { value: string }) => c.value),
  extractCredentialKey: jest.fn((s: string) => s),
  tryInContext: jest.fn().mockResolvedValue(null),
  toFirstCss: jest.fn(() => ''),
  resolveDashboardField: jest.fn().mockResolvedValue(null),
}));

jest.unstable_mockModule('../../../Common/Navigation.js', () => ({
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
  waitForNavigationAndDomLoad: jest.fn().mockResolvedValue(undefined),
  getCurrentUrl: jest.fn().mockResolvedValue('https://www.max.co.il'),
  waitForRedirect: jest.fn().mockResolvedValue(undefined),
  waitForUrl: jest.fn().mockResolvedValue(undefined),
}));

const { MAX_CONFIG } = await import('../../../Scrapers/Max/Config/MaxLoginConfig.js');

const MOCK_WAIT_FOR_SELECTOR = jest.fn().mockResolvedValue(undefined);

/**
 * Creates a mock Page object with configurable URL.
 * @param url - the URL the page should report
 * @returns a mock Page instance
 */
function makeMockPage(url = 'https://www.max.co.il/login'): Page {
  return {
    url: jest.fn().mockReturnValue(url),
    $eval: jest.fn().mockResolvedValue(undefined),
    waitForSelector: MOCK_WAIT_FOR_SELECTOR,
    waitForURL: jest.fn().mockResolvedValue(undefined),
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    locator: jest.fn().mockReturnValue({
      first: jest.fn().mockReturnValue({
        isVisible: jest.fn().mockResolvedValue(true),
        waitFor: jest.fn().mockResolvedValue(undefined),
        click: jest.fn().mockResolvedValue(undefined),
        count: jest.fn().mockResolvedValue(1),
      }),
    }),
    frames: jest.fn().mockReturnValue([]),
  } as unknown as Page;
}

describe('MAX_CONFIG preAction force-click fallback', () => {
  beforeEach(() => jest.clearAllMocks());

  it('falls back to force-click when locator is not visible', async () => {
    MOCK_ELEMENT_PRESENT.mockResolvedValue(false);
    const mockClick = jest.fn().mockResolvedValue(undefined);
    const mockLocator = jest.fn().mockReturnValue({
      first: jest.fn().mockReturnValue({
        isVisible: jest.fn().mockResolvedValue(false),
        waitFor: jest.fn().mockRejectedValue(new Error('timeout')),
        click: mockClick,
        count: jest.fn().mockResolvedValue(1),
      }),
    });
    const page = makeMockPage();
    (page as unknown as { locator: jest.Mock }).locator = mockLocator;
    await MAX_CONFIG.preAction?.(page);
    expect(mockClick).toHaveBeenCalledWith({ force: true });
  });

  it('skips force-click when element count is zero', async () => {
    MOCK_ELEMENT_PRESENT.mockResolvedValue(false);
    const mockClick = jest.fn().mockResolvedValue(undefined);
    const mockLocator = jest.fn().mockReturnValue({
      first: jest.fn().mockReturnValue({
        isVisible: jest.fn().mockResolvedValue(false),
        waitFor: jest.fn().mockRejectedValue(new Error('timeout')),
        click: mockClick,
        count: jest.fn().mockResolvedValue(0),
      }),
    });
    const page = makeMockPage();
    (page as unknown as { locator: jest.Mock }).locator = mockLocator;
    await MAX_CONFIG.preAction?.(page);
    expect(mockClick).not.toHaveBeenCalled();
  });

  it('handles isVisible rejection gracefully and force-clicks', async () => {
    MOCK_ELEMENT_PRESENT.mockResolvedValue(false);
    const mockClick = jest.fn().mockResolvedValue(undefined);
    const mockLocator = jest.fn().mockReturnValue({
      first: jest.fn().mockReturnValue({
        isVisible: jest.fn().mockRejectedValue('detached'),
        waitFor: jest.fn().mockRejectedValue(new Error('timeout')),
        click: mockClick,
        count: jest.fn().mockResolvedValue(1),
      }),
    });
    const page = makeMockPage();
    (page as unknown as { locator: jest.Mock }).locator = mockLocator;
    await MAX_CONFIG.preAction?.(page);
    expect(mockClick).toHaveBeenCalledWith({ force: true });
  });
});

describe('MAX_CONFIG possibleResults edge cases', () => {
  beforeEach(() => jest.clearAllMocks());

  it('success returns false when opts is undefined', () => {
    const checker = MAX_CONFIG.possibleResults.success[0] as (opts?: unknown) => boolean;
    const isMatch = checker(undefined);
    expect(isMatch).toBe(false);
  });

  it('success returns false when opts.page is undefined', () => {
    const checker = MAX_CONFIG.possibleResults.success[0] as (opts?: unknown) => boolean;
    const isMatch = checker({});
    expect(isMatch).toBe(false);
  });

  it('invalidPassword returns false when opts is undefined', async () => {
    const checkers = MAX_CONFIG.possibleResults.invalidPassword;
    const checker = checkers?.[0] as (opts?: unknown) => Promise<boolean>;
    const isInvalid = await checker(undefined);
    expect(isInvalid).toBe(false);
  });

  it('invalidPassword returns false when opts.page is undefined', async () => {
    const checkers = MAX_CONFIG.possibleResults.invalidPassword;
    const checker = checkers?.[0] as (opts?: unknown) => Promise<boolean>;
    const isInvalid = await checker({});
    expect(isInvalid).toBe(false);
  });

  it('unknownError returns false when opts is undefined', async () => {
    const checkers = MAX_CONFIG.possibleResults.unknownError;
    const checker = checkers?.[0] as (opts?: unknown) => Promise<boolean>;
    const isError = await checker(undefined);
    expect(isError).toBe(false);
  });

  it('unknownError returns false when opts.page is undefined', async () => {
    const checkers = MAX_CONFIG.possibleResults.unknownError;
    const checker = checkers?.[0] as (opts?: unknown) => Promise<boolean>;
    const isError = await checker({});
    expect(isError).toBe(false);
  });
});
