import { jest } from '@jest/globals';
import type { Page } from 'playwright';

const MOCK_WAIT_UNTIL_ELEMENT_FOUND = jest.fn().mockResolvedValue(undefined);
const MOCK_WAIT_UNTIL_ELEMENT_DISAPPEAR = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('../../../Common/Debug.js', () => ({
  /**
   * Creates a stub logger for the Debug module mock.
   * @returns stub logger with jest.fn() methods
   */
  getDebug: (): Record<string, jest.Mock> => ({
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

jest.unstable_mockModule('../../../Common/ElementsInteractions.js', () => ({
  waitUntilElementFound: MOCK_WAIT_UNTIL_ELEMENT_FOUND,
  waitUntilElementDisappear: MOCK_WAIT_UNTIL_ELEMENT_DISAPPEAR,
  clickButton: jest.fn().mockResolvedValue(undefined),
  fillInput: jest.fn().mockResolvedValue(undefined),
  elementPresentOnPage: jest.fn().mockResolvedValue(false),
  waitUntilIframeFound: jest.fn().mockResolvedValue(undefined),
  pageEval: jest.fn().mockResolvedValue(''),
  capturePageText: jest.fn().mockResolvedValue(''),
}));

jest.unstable_mockModule('../../../Common/Navigation.js', () => ({
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
  waitForRedirect: jest.fn().mockResolvedValue(undefined),
  getCurrentUrl: jest.fn().mockResolvedValue(''),
  waitForUrl: jest.fn().mockResolvedValue(undefined),
  waitForNavigationAndDomLoad: jest.fn().mockResolvedValue(undefined),
}));

const { MIZRAHI_CONFIG } = await import('../../../Scrapers/Mizrahi/Config/MizrahiLoginConfig.js');

const MOCK_GOTO = jest.fn().mockResolvedValue(undefined);
const MOCK_QUERY = jest.fn().mockResolvedValue(null);
const MOCK_QUERY_ALL = jest.fn().mockResolvedValue([]);

/**
 * Creates a mock Playwright Page for Mizrahi login config tests.
 * @param url - the URL that page.url() returns
 * @returns a mock Page with goto/query stubs
 */
function makeMockPage(url = 'https://mto.mizrahi-tefahot.co.il/OnlineApp/'): Page {
  MOCK_GOTO.mockClear();
  MOCK_QUERY.mockClear();
  MOCK_QUERY_ALL.mockClear();
  return {
    url: jest.fn().mockReturnValue(url),
    goto: MOCK_GOTO,
    $: MOCK_QUERY,
    $$: MOCK_QUERY_ALL,
  } as unknown as Page;
}

describe('MIZRAHI_CONFIG', () => {
  beforeEach(() => jest.clearAllMocks());

  it('has loginUrl from ScraperConfig', () => {
    expect(MIZRAHI_CONFIG.loginUrl).toBeDefined();
    expect(typeof MIZRAHI_CONFIG.loginUrl).toBe('string');
  });

  it('has username and password fields', () => {
    expect(MIZRAHI_CONFIG.fields).toHaveLength(2);
    expect(MIZRAHI_CONFIG.fields[0].credentialKey).toBe('username');
    expect(MIZRAHI_CONFIG.fields[1].credentialKey).toBe('password');
  });

  it('uses empty selectors (wellKnown fallback) for all fields', () => {
    for (const field of MIZRAHI_CONFIG.fields) {
      expect(field.selectors).toEqual([]);
    }
  });

  it('has submit selector', () => {
    const submit = Array.isArray(MIZRAHI_CONFIG.submit)
      ? MIZRAHI_CONFIG.submit
      : [MIZRAHI_CONFIG.submit];
    expect(submit.length).toBeGreaterThan(0);
  });

  it('has checkReadiness function', () => {
    expect(typeof MIZRAHI_CONFIG.checkReadiness).toBe('function');
  });

  it('has postAction function', () => {
    expect(typeof MIZRAHI_CONFIG.postAction).toBe('function');
  });

  describe('checkReadiness', () => {
    it('navigates to loginRoute', async () => {
      const page = makeMockPage();
      const checkReadiness = MIZRAHI_CONFIG.checkReadiness;
      expect(checkReadiness).toBeDefined();
      await checkReadiness?.(page);
      const mizrahiSubstring: string = expect.stringContaining('mizrahi') as string;
      const anyObject: object = expect.any(Object) as object;
      expect(MOCK_GOTO).toHaveBeenCalledWith(mizrahiSubstring, anyObject);
    });

    it('waits for overlay to disappear', async () => {
      const page = makeMockPage();
      const checkReadiness = MIZRAHI_CONFIG.checkReadiness;
      await checkReadiness?.(page);
      expect(MOCK_WAIT_UNTIL_ELEMENT_DISAPPEAR).toHaveBeenCalledWith(
        page,
        'div.ngx-overlay.loading-foreground',
      );
    });
  });

  describe('postAction', () => {
    it('waits for dropdownBasic or invalid selector', async () => {
      const page = makeMockPage();
      const postAction = MIZRAHI_CONFIG.postAction;
      await postAction?.(page);
      expect(MOCK_WAIT_UNTIL_ELEMENT_FOUND).toHaveBeenCalledWith(page, '#dropdownBasic');
    });
  });

  describe('possibleResults.success', () => {
    it('regex matches Mizrahi online app URL', () => {
      const regex = MIZRAHI_CONFIG.possibleResults.success[0] as RegExp;
      const isMatch = regex.test('https://mto.mizrahi-tefahot.co.il/OnlineApp/dashboard');
      expect(isMatch).toBe(true);
    });

    it('regex rejects non-Mizrahi URL', () => {
      const regex = MIZRAHI_CONFIG.possibleResults.success[0] as RegExp;
      const isMatch = regex.test('https://other-bank.co.il/dashboard');
      expect(isMatch).toBe(false);
    });

    it('mizrahiIsLoggedIn returns true when element exists', async () => {
      const fn = MIZRAHI_CONFIG.possibleResults.success[1] as (opts: {
        page: Page;
      }) => Promise<boolean>;
      const page = makeMockPage();
      MOCK_QUERY_ALL.mockResolvedValue([{}]);
      expect(await fn({ page })).toBe(true);
    });

    it('mizrahiIsLoggedIn returns false when no page', async () => {
      const fn = MIZRAHI_CONFIG.possibleResults.success[1] as (opts?: {
        page?: Page;
      }) => Promise<boolean>;
      expect(await fn()).toBe(false);
      expect(await fn({})).toBe(false);
    });

    it('mizrahiIsLoggedIn returns false when no element', async () => {
      const fn = MIZRAHI_CONFIG.possibleResults.success[1] as (opts: {
        page: Page;
      }) => Promise<boolean>;
      const page = makeMockPage();
      MOCK_QUERY_ALL.mockResolvedValue([]);
      expect(await fn({ page })).toBe(false);
    });
  });

  describe('possibleResults.invalidPassword', () => {
    it('returns true when element present', async () => {
      const invalidPasswordResults = MIZRAHI_CONFIG.possibleResults.invalidPassword ?? [];
      const fn = invalidPasswordResults[0] as (opts: { page: Page }) => Promise<boolean>;
      const page = makeMockPage();
      MOCK_QUERY.mockResolvedValue({});
      expect(await fn({ page })).toBe(true);
    });

    it('returns false when element absent', async () => {
      const invalidPasswordResults = MIZRAHI_CONFIG.possibleResults.invalidPassword ?? [];
      const fn = invalidPasswordResults[0] as (opts: { page: Page }) => Promise<boolean>;
      const page = makeMockPage();
      MOCK_QUERY.mockResolvedValue(null);
      expect(await fn({ page })).toBe(false);
    });
  });
});
