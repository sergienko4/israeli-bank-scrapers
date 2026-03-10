import { jest } from '@jest/globals';

const MOCK_ELEMENT_PRESENT = jest.fn().mockResolvedValue(false);

jest.unstable_mockModule(
  '../../Common/Debug.js',
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

jest.unstable_mockModule('../../Common/Waiting.js', () => ({
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

jest.unstable_mockModule('../../Common/ElementsInteractions.js', () => ({
  fillInput: jest.fn().mockResolvedValue(undefined),
  clickButton: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
  elementPresentOnPage: MOCK_ELEMENT_PRESENT,
  capturePageText: jest.fn().mockResolvedValue(''),
}));

jest.unstable_mockModule('../../Common/SelectorResolver.js', () => ({
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

jest.unstable_mockModule('../../Common/Navigation.js', () => ({
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
  waitForNavigationAndDomLoad: jest.fn().mockResolvedValue(undefined),
  getCurrentUrl: jest.fn().mockResolvedValue('https://www.max.co.il'),
  waitForRedirect: jest.fn().mockResolvedValue(undefined),
  waitForUrl: jest.fn().mockResolvedValue(undefined),
}));

/** Shared locator stub for WellKnownLocators mock. */
const LOCATOR_STUB: Record<string, jest.Mock> = {
  first: jest.fn(),
  waitFor: jest.fn().mockResolvedValue(undefined),
  fill: jest.fn().mockResolvedValue(undefined),
  click: jest.fn().mockResolvedValue(undefined),
  and: jest.fn(),
  getByPlaceholder: jest.fn(),
  getByRole: jest.fn(),
  locator: jest.fn(),
};
LOCATOR_STUB.first.mockReturnValue(LOCATOR_STUB);
LOCATOR_STUB.and.mockReturnValue(LOCATOR_STUB);
LOCATOR_STUB.getByPlaceholder.mockReturnValue(LOCATOR_STUB);
LOCATOR_STUB.getByRole.mockReturnValue(LOCATOR_STUB);
LOCATOR_STUB.locator.mockReturnValue(LOCATOR_STUB);

jest.unstable_mockModule('../../Common/WellKnownLocators.js', () => ({
  wellKnownPlaceholder: jest.fn().mockReturnValue(LOCATOR_STUB),
  wellKnownSubmitButton: jest.fn().mockReturnValue(LOCATOR_STUB),
  findFormByField: jest.fn().mockReturnValue(LOCATOR_STUB),
}));

const { MAX_CONFIG } = await import('../../Scrapers/Max/MaxLoginConfig.js');

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
