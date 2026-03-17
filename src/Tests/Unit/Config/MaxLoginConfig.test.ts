import { jest } from '@jest/globals';
import type { Page } from 'playwright-core';

import type { LifecyclePromise } from '../../../Scrapers/Base/Interfaces/CallbackTypes.js';
import { CREDS_USERNAME_PASSWORD } from '../../TestConstants.js';

const MOCK_RESOLVE_FIELD_CONTEXT = jest.fn();
const MOCK_FILL_INPUT = jest.fn().mockResolvedValue(undefined);
const MOCK_CLICK_BUTTON = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('../../../Common/Debug.js', () => ({
  /**
   * Debug logger factory.
   * @returns Stub logger with all log levels mocked.
   */
  getDebug: (): Record<string, jest.Mock> => ({
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));
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
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
  elementPresentOnPage: jest.fn().mockResolvedValue(false),
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
/** Mock locator with first() returning self. */
interface IMockLocator {
  isVisible: jest.Mock;
  waitFor: jest.Mock;
  click: jest.Mock;
  first: jest.Mock;
}
/**
 * Create a self-referencing mock locator.
 * @param visible - Whether isVisible resolves to true.
 * @returns A mock locator whose first() returns itself.
 */
function makeMockLocator(visible = false): IMockLocator {
  const loc: IMockLocator = {
    isVisible: jest.fn().mockResolvedValue(visible),
    waitFor: visible
      ? jest.fn().mockResolvedValue(undefined)
      : jest.fn().mockRejectedValue(new Error('not visible')),
    click: jest.fn().mockResolvedValue(undefined),
    first: jest.fn(),
  };
  loc.first.mockReturnValue(loc);
  return loc;
}
const MOCK_GET_BY_TEXT = jest.fn().mockImplementation(() => makeMockLocator());
const MOCK_GET_BY_ROLE = jest.fn().mockImplementation(() => makeMockLocator());
const ALL_MOCKS = [
  MOCK_PAGE_EVAL,
  MOCK_WAIT_FOR_SELECTOR,
  MOCK_WAIT_FOR_URL,
  MOCK_LOCATOR,
  MOCK_GET_BY_TEXT,
  MOCK_GET_BY_ROLE,
];
/**
 * Reset all shared mocks and wire getByText/getByRole.
 * @returns The number of mocks cleared.
 */
function resetMocks(): number {
  for (const m of ALL_MOCKS) m.mockClear();
  MOCK_GET_BY_TEXT.mockImplementation(() => makeMockLocator());
  MOCK_GET_BY_ROLE.mockImplementation(() => makeMockLocator());
  return ALL_MOCKS.length;
}
/**
 * Build locator-related stubs wired to shared mocks.
 * @returns Locator, getByText, and getByRole stubs.
 */
function makeLocatorStub(): Pick<Page, 'locator' | 'getByText' | 'getByRole'> {
  return {
    locator: MOCK_LOCATOR as Page['locator'],
    getByText: MOCK_GET_BY_TEXT as Page['getByText'],
    getByRole: MOCK_GET_BY_ROLE as Page['getByRole'],
  };
}
/**
 * Build core page stubs (url, eval, waitFor*, frames).
 * @param url - The URL the mock page reports.
 * @param bodyText - The visible body text for detectIdForm.
 * @returns Core page stubs.
 */
function makePageCoreStub(
  url: string,
  bodyText: string,
): Pick<
  Page,
  'url' | '$eval' | 'evaluate' | 'waitForSelector' | 'waitForURL' | 'waitForTimeout' | 'frames'
> {
  return {
    url: jest.fn().mockReturnValue(url) as Page['url'],
    $eval: MOCK_PAGE_EVAL as Page['$eval'],
    evaluate: jest.fn().mockResolvedValue(bodyText) as Page['evaluate'],
    waitForSelector: MOCK_WAIT_FOR_SELECTOR as Page['waitForSelector'],
    waitForURL: MOCK_WAIT_FOR_URL as Page['waitForURL'],
    waitForTimeout: jest.fn().mockResolvedValue(undefined) as Page['waitForTimeout'],
    frames: jest.fn().mockReturnValue([]) as Page['frames'],
  };
}
/**
 * Create a mock Page with configurable URL and body text.
 * @param url - The URL the mock page reports.
 * @param bodyText - The visible body text for detectIdForm.
 * @returns A stubbed Playwright Page instance.
 */
function makeMockPage(url = 'https://www.max.co.il/login', bodyText = ''): Page {
  resetMocks();
  return { ...makePageCoreStub(url, bodyText), ...makeLocatorStub() } as unknown as Page;
}
/**
 * Build a post-action from credentials.
 * @param creds - Max credentials with optional ID.
 * @returns The post-action function.
 */
function buildAction(creds: IMaxCredentials): (_: Page) => LifecyclePromise {
  return BUILD_MAX_POST_ACTION(creds);
}

describe('buildMaxPostAction', () => {
  beforeEach(() => jest.clearAllMocks());
  it('waits for dashboard without resolving fields when credentials.id is absent', async () => {
    const page = makeMockPage('https://www.max.co.il/login');
    const action = buildAction(CREDS_USERNAME_PASSWORD);
    await action(page);
    expect(MOCK_RESOLVE_FIELD_CONTEXT).not.toHaveBeenCalled();
    expect(MOCK_FILL_INPUT).not.toHaveBeenCalled();
    expect(MOCK_WAIT_FOR_URL).toHaveBeenCalled();
  });
  it('waits for dashboard without filling when page has no ID text', async () => {
    const page = makeMockPage('https://www.max.co.il/login', 'שם משתמש סיסמה');
    const action = buildAction({ ...CREDS_USERNAME_PASSWORD, id: '123456789' });
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
    const action = buildAction({ ...CREDS_USERNAME_PASSWORD, id: '123456789' });
    await action(page);
    expect(MOCK_FILL_INPUT).toHaveBeenCalledTimes(3);
    expect(MOCK_CLICK_BUTTON).toHaveBeenCalled();
  });
  it('skips username fill when username resolution fails', async () => {
    const page = makeMockPage('https://www.max.co.il/login', 'תעודת זהות');
    MOCK_RESOLVE_FIELD_CONTEXT.mockResolvedValueOnce({ isResolved: false })
      .mockResolvedValueOnce({ isResolved: true, selector: '#password', context: page })
      .mockResolvedValueOnce({ isResolved: true, selector: '#id', context: page });
    const action = buildAction({ ...CREDS_USERNAME_PASSWORD, id: '123' });
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
    const action = buildAction({ ...CREDS_USERNAME_PASSWORD, id: '123' });
    await action(page);
    expect(MOCK_FILL_INPUT).toHaveBeenCalledTimes(2);
    expect(MOCK_CLICK_BUTTON).toHaveBeenCalled();
  });
  it('fills only ID when both username and password resolution fail', async () => {
    const page = makeMockPage('https://www.max.co.il/login', 'ת.ז.');
    MOCK_RESOLVE_FIELD_CONTEXT.mockResolvedValueOnce({ isResolved: false })
      .mockResolvedValueOnce({ isResolved: false })
      .mockResolvedValueOnce({ isResolved: true, selector: '#id', context: page });
    const action = buildAction({ ...CREDS_USERNAME_PASSWORD, id: '123' });
    await action(page);
    expect(MOCK_FILL_INPUT).toHaveBeenCalledTimes(1);
    expect(MOCK_CLICK_BUTTON).toHaveBeenCalled();
  });
  it('returns immediately when already on homepage', async () => {
    const page = makeMockPage('https://www.max.co.il/homepage/personal');
    const action = buildAction(CREDS_USERNAME_PASSWORD);
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
    type SuccessChecker = (_: { page?: { url(): string } }) => boolean;
    /** First success predicate.
     * @returns The checker function. */
    function getChecker(): SuccessChecker {
      const checker = MAX_CONFIG.possibleResults.success[0];
      if (typeof checker !== 'function') throw new TypeError('Expected function');
      return checker as SuccessChecker;
    }
    /**
     * Homepage URL stub.
     * @returns The homepage URL.
     */
    const homepageUrlFn = (): string => 'https://www.max.co.il/homepage/personal';
    /**
     * Login URL stub.
     * @returns The login page URL.
     */
    const loginUrlFn = (): string => 'https://www.max.co.il/login';
    it('returns true when URL starts with homepage', () => {
      const checker = getChecker();
      const isSuccess = checker({ page: { url: homepageUrlFn } });
      expect(isSuccess).toBe(true);
    });
    it('returns false when URL is not homepage', () => {
      const checker = getChecker();
      const isSuccess = checker({ page: { url: loginUrlFn } });
      expect(isSuccess).toBe(false);
    });
  });
  describe('possibleResults.invalidPassword', () => {
    it('returns true when error text is visible', async () => {
      const page = makeMockPage();
      const errorLoc = makeMockLocator(true);
      MOCK_GET_BY_TEXT.mockReturnValue(errorLoc);
      const invalidPwCheckers = MAX_CONFIG.possibleResults.invalidPassword ?? [];
      const checker = invalidPwCheckers[0] as (_: { page: Page }) => Promise<boolean>;
      const isInvalid = await checker({ page });
      expect(isInvalid).toBe(true);
    });
    it('returns false when error text is absent', async () => {
      const page = makeMockPage();
      const invalidPwCheckers = MAX_CONFIG.possibleResults.invalidPassword ?? [];
      const checker = invalidPwCheckers[0] as (_: { page: Page }) => Promise<boolean>;
      const isInvalid = await checker({ page });
      expect(isInvalid).toBe(false);
    });
  });
  describe('possibleResults.unknownError', () => {
    it('returns true when error text is visible', async () => {
      const page = makeMockPage();
      const errorLoc = makeMockLocator(true);
      MOCK_GET_BY_TEXT.mockReturnValue(errorLoc);
      const unknownErrCheckers = MAX_CONFIG.possibleResults.unknownError ?? [];
      const checker = unknownErrCheckers[1] as (_: { page: Page }) => Promise<boolean>;
      const isError = await checker({ page });
      expect(isError).toBe(true);
    });
    it('returns false when error text is absent', async () => {
      const page = makeMockPage();
      const unknownErrCheckers = MAX_CONFIG.possibleResults.unknownError ?? [];
      const checker = unknownErrCheckers[1] as (_: { page: Page }) => Promise<boolean>;
      const isError = await checker({ page });
      expect(isError).toBe(false);
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
      const page = makeMockPage();
      const preAction =
        MAX_CONFIG.preAction ?? ((): Promise<undefined> => Promise.resolve(undefined));
      const didPreAction = await preAction(page);
      expect(didPreAction).toBeUndefined();
      expect(MOCK_LOCATOR).toHaveBeenCalled();
    });
    it('closes popup if present before navigating', async () => {
      const page = makeMockPage();
      const closeEl = makeMockLocator(true);
      MOCK_GET_BY_TEXT.mockReturnValue(closeEl);
      const preAction = MAX_CONFIG.preAction;
      if (preAction) await preAction(page);
      expect(closeEl.click).toHaveBeenCalled();
    });
  });
});
