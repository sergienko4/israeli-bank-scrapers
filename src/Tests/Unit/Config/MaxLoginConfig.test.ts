import { jest } from '@jest/globals';
import type { Page } from 'playwright-core';

import type { LifecyclePromise } from '../../../Scrapers/Base/Interfaces/CallbackTypes.js';

const MOCK_RESOLVE_FIELD_CONTEXT = jest.fn();
const MOCK_FILL_INPUT = jest.fn().mockResolvedValue(undefined);
const MOCK_CLICK_BUTTON = jest.fn().mockResolvedValue(undefined);
const MOCK_ELEMENT_PRESENT_ON_PAGE = jest.fn().mockResolvedValue(false);
const MOCK_WAIT_UNTIL_ELEMENT_FOUND = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule(
  '../../../Common/Debug.js',
  /**
   * Mock Debug module.
   * @returns mocked debug exports
   */
  (): { getDebug: () => Record<string, jest.Mock> } => ({
    /**
     * Debug factory.
     * @returns mock logger
     */
    getDebug: (): Record<string, jest.Mock> => ({
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
  runSerial: jest.fn().mockResolvedValue([]),
  TimeoutError: class TimeoutError extends Error {},
  SECOND: 1000,
}));

jest.unstable_mockModule('../../../Common/ElementsInteractions.js', () => ({
  fillInput: MOCK_FILL_INPUT,
  clickButton: MOCK_CLICK_BUTTON,
  waitUntilElementFound: MOCK_WAIT_UNTIL_ELEMENT_FOUND,
  elementPresentOnPage: MOCK_ELEMENT_PRESENT_ON_PAGE,
  capturePageText: jest.fn().mockResolvedValue(''),
}));

jest.unstable_mockModule('../../../Common/SelectorResolver.js', () => ({
  resolveFieldWithCache: jest
    .fn()
    .mockResolvedValue({ isResolved: false, selector: '', context: {} }),
  resolveFieldContext: MOCK_RESOLVE_FIELD_CONTEXT,
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

const { buildMaxPostAction: BUILD_MAX_POST_ACTION, MAX_CONFIG } =
  await import('../../../Scrapers/Max/Config/MaxLoginConfig.js');

type IMaxCredentials = Parameters<typeof BUILD_MAX_POST_ACTION>[0];

const MOCK_PAGE_EVAL = jest.fn().mockResolvedValue(undefined);
const MOCK_WAIT_FOR_SELECTOR = jest.fn().mockResolvedValue(undefined);
const MOCK_WAIT_FOR_URL = jest.fn().mockResolvedValue(undefined);
const MOCK_LOCATOR = jest.fn().mockReturnValue({
  first: jest.fn().mockReturnValue({
    isVisible: jest.fn().mockResolvedValue(true),
    waitFor: jest.fn().mockResolvedValue(undefined),
    click: jest.fn().mockResolvedValue(undefined),
    count: jest.fn().mockResolvedValue(1),
  }),
});

/**
 * Creates a mock Page with configurable URL and stubbed Playwright methods.
 * @param url - The URL the mock page reports.
 * @returns A mock Page instance.
 */
/**
 * Creates a mock Page with configurable URL, body text, and stubbed Playwright methods.
 * @param url - The URL the mock page reports.
 * @param bodyText - The visible body text for detectIdForm checks.
 * @returns A mock Page instance.
 */
function makeMockPage(url = 'https://www.max.co.il/login', bodyText = ''): Page {
  MOCK_PAGE_EVAL.mockClear();
  MOCK_WAIT_FOR_SELECTOR.mockClear();
  MOCK_WAIT_FOR_URL.mockClear();
  MOCK_LOCATOR.mockClear();
  return {
    url: jest.fn().mockReturnValue(url),
    $eval: MOCK_PAGE_EVAL,
    evaluate: jest.fn().mockResolvedValue(bodyText),
    waitForSelector: MOCK_WAIT_FOR_SELECTOR,
    waitForURL: MOCK_WAIT_FOR_URL,
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    locator: MOCK_LOCATOR,
    frames: jest.fn().mockReturnValue([]),
  } as unknown as Page;
}

describe('buildMaxPostAction', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * Build a post-action function from the given credentials.
   * @param creds - Max credentials with optional ID.
   * @returns The post-action function bound to those credentials.
   */
  function buildAction(creds: IMaxCredentials): (page: Page) => LifecyclePromise {
    return BUILD_MAX_POST_ACTION(creds);
  }

  it('waits for dashboard without resolving fields when credentials.id is absent', async () => {
    const page = makeMockPage('https://www.max.co.il/login');
    const action = buildAction({ username: 'user', password: 'pass' });
    await action(page);
    expect(MOCK_RESOLVE_FIELD_CONTEXT).not.toHaveBeenCalled();
    expect(MOCK_FILL_INPUT).not.toHaveBeenCalled();
    expect(MOCK_WAIT_FOR_URL).toHaveBeenCalled();
  });

  it('waits for dashboard without filling when page has no ID text', async () => {
    const page = makeMockPage('https://www.max.co.il/login', 'שם משתמש סיסמה');
    const action = buildAction({ username: 'user', password: 'pass', id: '123456789' });
    await action(page);
    expect(MOCK_FILL_INPUT).not.toHaveBeenCalled();
    expect(MOCK_WAIT_FOR_URL).toHaveBeenCalled();
  });

  it('fills username, password, and ID when page shows ID form', async () => {
    const page = makeMockPage('https://www.max.co.il/login', 'הזן תעודת הזהות שלך');
    MOCK_RESOLVE_FIELD_CONTEXT.mockResolvedValueOnce({
      isResolved: true,
      selector: '#user-name',
      context: page,
    })
      .mockResolvedValueOnce({ isResolved: true, selector: '#password', context: page })
      .mockResolvedValueOnce({ isResolved: true, selector: '#id', context: page });
    const action = buildAction({ username: 'testuser', password: 'testpass', id: '123456789' });
    await action(page);
    expect(MOCK_FILL_INPUT).toHaveBeenCalledTimes(3);
    expect(MOCK_CLICK_BUTTON).toHaveBeenCalled();
  });

  it('skips username fill when username resolution fails', async () => {
    const page = makeMockPage('https://www.max.co.il/login', 'תעודת זהות');
    MOCK_RESOLVE_FIELD_CONTEXT.mockResolvedValueOnce({ isResolved: false })
      .mockResolvedValueOnce({ isResolved: true, selector: '#password', context: page })
      .mockResolvedValueOnce({ isResolved: true, selector: '#id', context: page });
    const action = buildAction({ username: 'u', password: 'p', id: '123' });
    await action(page);
    expect(MOCK_FILL_INPUT).toHaveBeenCalledTimes(2);
    expect(MOCK_CLICK_BUTTON).toHaveBeenCalled();
  });

  it('skips password fill when password resolution fails', async () => {
    const page = makeMockPage('https://www.max.co.il/login', 'תעודת זהות');
    MOCK_RESOLVE_FIELD_CONTEXT.mockResolvedValueOnce({
      isResolved: true,
      selector: '#user-name',
      context: page,
    })
      .mockResolvedValueOnce({ isResolved: false })
      .mockResolvedValueOnce({ isResolved: true, selector: '#id', context: page });
    const action = buildAction({ username: 'u', password: 'p', id: '123' });
    await action(page);
    expect(MOCK_FILL_INPUT).toHaveBeenCalledTimes(2);
    expect(MOCK_CLICK_BUTTON).toHaveBeenCalled();
  });

  it('fills only ID when both username and password resolution fail', async () => {
    const page = makeMockPage('https://www.max.co.il/login', 'ת.ז.');
    MOCK_RESOLVE_FIELD_CONTEXT.mockResolvedValueOnce({ isResolved: false })
      .mockResolvedValueOnce({ isResolved: false })
      .mockResolvedValueOnce({ isResolved: true, selector: '#id', context: page });
    const action = buildAction({ username: 'u', password: 'p', id: '123' });
    await action(page);
    expect(MOCK_FILL_INPUT).toHaveBeenCalledTimes(1);
    expect(MOCK_CLICK_BUTTON).toHaveBeenCalled();
  });

  it('returns immediately when already on homepage', async () => {
    const page = makeMockPage('https://www.max.co.il/homepage/personal');
    const action = buildAction({ username: 'u', password: 'p' });
    await action(page);
    expect(MOCK_WAIT_FOR_URL).not.toHaveBeenCalled();
  });
});

describe('MAX_CONFIG', () => {
  it('has loginUrl from ScraperConfig', () => {
    expect(MAX_CONFIG.loginUrl).toBeDefined();
    expect(typeof MAX_CONFIG.loginUrl).toBe('string');
  });

  it('has username and password fields', () => {
    expect(MAX_CONFIG.fields).toHaveLength(2);
    expect(MAX_CONFIG.fields[0].credentialKey).toBe('username');
    expect(MAX_CONFIG.fields[1].credentialKey).toBe('password');
  });

  it('has submit selectors', () => {
    const submitArr = Array.isArray(MAX_CONFIG.submit) ? MAX_CONFIG.submit : [MAX_CONFIG.submit];
    expect(submitArr.length).toBeGreaterThan(0);
  });

  describe('possibleResults.success', () => {
    /**
     * Extracts the first success predicate from MAX_CONFIG.
     * @returns The success checker function.
     */
    function getSuccessChecker(): (opts: { page?: { url(): string } }) => boolean {
      return MAX_CONFIG.possibleResults.success[0] as (opts: {
        page?: { url(): string };
      }) => boolean;
    }

    it('returns true when URL starts with homepage', () => {
      const checker = getSuccessChecker();
      /**
       * Stub returning the homepage URL.
       * @returns the homepage URL
       */
      const urlFn = (): string => 'https://www.max.co.il/homepage/personal';
      const isSuccess = checker({ page: { url: urlFn } });
      expect(isSuccess).toBe(true);
    });

    it('returns false when URL is not homepage', () => {
      const checker = getSuccessChecker();
      /**
       * Stub returning the login URL.
       * @returns the login URL
       */
      const urlFn = (): string => 'https://www.max.co.il/login';
      const isSuccess = checker({ page: { url: urlFn } });
      expect(isSuccess).toBe(false);
    });
  });

  describe('possibleResults.invalidPassword', () => {
    it('returns true when popupWrongDetails element present', async () => {
      MOCK_ELEMENT_PRESENT_ON_PAGE.mockResolvedValue(true);
      const invalidPwCheckers = MAX_CONFIG.possibleResults.invalidPassword ?? [];
      const checker = invalidPwCheckers[0] as (opts: { page: Page }) => Promise<boolean>;
      const page = makeMockPage();
      const isInvalid = await checker({ page });
      expect(isInvalid).toBe(true);
    });

    it('returns false when popupWrongDetails element absent', async () => {
      MOCK_ELEMENT_PRESENT_ON_PAGE.mockResolvedValue(false);
      const invalidPwCheckers = MAX_CONFIG.possibleResults.invalidPassword ?? [];
      const checker = invalidPwCheckers[0] as (opts: { page: Page }) => Promise<boolean>;
      const page = makeMockPage();
      const isInvalid = await checker({ page });
      expect(isInvalid).toBe(false);
    });
  });

  describe('possibleResults.unknownError', () => {
    it('returns true when popupCardHoldersLoginError present', async () => {
      MOCK_ELEMENT_PRESENT_ON_PAGE.mockResolvedValue(true);
      const unknownErrCheckers = MAX_CONFIG.possibleResults.unknownError ?? [];
      const checker = unknownErrCheckers[0] as (opts: { page: Page }) => Promise<boolean>;
      const page = makeMockPage();
      const isError = await checker({ page });
      expect(isError).toBe(true);
    });
  });

  describe('checkReadiness', () => {
    it('waits for login button to be visible', async () => {
      const page = makeMockPage();
      const checkReadiness =
        MAX_CONFIG.checkReadiness ?? ((): Promise<boolean> => Promise.resolve(true));
      await checkReadiness(page);
      const loginBtnMatcher = expect.stringContaining('כניסה') as unknown;
      const visibleOpts = expect.objectContaining({ state: 'visible' }) as unknown;
      expect(MOCK_WAIT_FOR_SELECTOR).toHaveBeenCalledWith(loginBtnMatcher, visibleOpts);
    });
  });

  describe('preAction', () => {
    it('clicks navigation buttons and waits for username input', async () => {
      MOCK_ELEMENT_PRESENT_ON_PAGE.mockResolvedValue(false);
      const page = makeMockPage();
      const preAction =
        MAX_CONFIG.preAction ?? ((): Promise<undefined> => Promise.resolve(undefined));
      const didPreAction = await preAction(page);
      expect(didPreAction).toBeUndefined();
      expect(MOCK_LOCATOR).toHaveBeenCalled();
    });

    it('closes popup if present before navigating', async () => {
      MOCK_ELEMENT_PRESENT_ON_PAGE.mockResolvedValue(true);
      const page = makeMockPage();
      const preAction =
        MAX_CONFIG.preAction ?? ((): Promise<undefined> => Promise.resolve(undefined));
      await preAction(page);
      const anyFn = expect.any(Function) as unknown;
      expect(MOCK_PAGE_EVAL).toHaveBeenCalledWith('#closePopup', anyFn);
    });
  });
});
