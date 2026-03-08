import { jest } from '@jest/globals';
import type { Page } from 'playwright';

const mockWaitUntilElementFound = jest.fn().mockResolvedValue(undefined);
const mockWaitUntilElementDisappear = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('../../Common/Debug.js', () => ({
  getDebug: () => ({
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

jest.unstable_mockModule('../../Common/ElementsInteractions.js', () => ({
  waitUntilElementFound: mockWaitUntilElementFound,
  waitUntilElementDisappear: mockWaitUntilElementDisappear,
  clickButton: jest.fn().mockResolvedValue(undefined),
  fillInput: jest.fn().mockResolvedValue(undefined),
  elementPresentOnPage: jest.fn().mockResolvedValue(false),
  waitUntilIframeFound: jest.fn().mockResolvedValue(undefined),
  pageEval: jest.fn().mockResolvedValue(''),
  capturePageText: jest.fn().mockResolvedValue(''),
}));

jest.unstable_mockModule('../../Common/Navigation.js', () => ({
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
  waitForRedirect: jest.fn().mockResolvedValue(undefined),
  getCurrentUrl: jest.fn().mockResolvedValue(''),
  waitForUrl: jest.fn().mockResolvedValue(undefined),
  waitForNavigationAndDomLoad: jest.fn().mockResolvedValue(undefined),
}));

const { MIZRAHI_CONFIG } = await import('../../Scrapers/Mizrahi/MizrahiLoginConfig.js');

const mockGoto = jest.fn().mockResolvedValue(undefined);
const mockQuery = jest.fn().mockResolvedValue(null);
const mockQueryAll = jest.fn().mockResolvedValue([]);

function makeMockPage(url = 'https://mto.mizrahi-tefahot.co.il/OnlineApp/'): Page {
  mockGoto.mockClear();
  mockQuery.mockClear();
  mockQueryAll.mockClear();
  return {
    url: jest.fn().mockReturnValue(url),
    goto: mockGoto,
    $: mockQuery,
    $$: mockQueryAll,
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
      await MIZRAHI_CONFIG.checkReadiness!(page);
      expect(mockGoto).toHaveBeenCalledWith(expect.stringContaining('mizrahi'), expect.any(Object));
    });

    it('waits for overlay to disappear', async () => {
      const page = makeMockPage();
      await MIZRAHI_CONFIG.checkReadiness!(page);
      expect(mockWaitUntilElementDisappear).toHaveBeenCalledWith(
        page,
        'div.ngx-overlay.loading-foreground',
      );
    });
  });

  describe('postAction', () => {
    it('waits for dropdownBasic or invalid selector', async () => {
      const page = makeMockPage();
      await MIZRAHI_CONFIG.postAction!(page);
      expect(mockWaitUntilElementFound).toHaveBeenCalledWith(page, '#dropdownBasic');
    });
  });

  describe('possibleResults.success', () => {
    it('regex matches Mizrahi online app URL', () => {
      const regex = MIZRAHI_CONFIG.possibleResults.success[0] as RegExp;
      expect(regex.test('https://mto.mizrahi-tefahot.co.il/OnlineApp/dashboard')).toBe(true);
    });

    it('regex rejects non-Mizrahi URL', () => {
      const regex = MIZRAHI_CONFIG.possibleResults.success[0] as RegExp;
      expect(regex.test('https://other-bank.co.il/dashboard')).toBe(false);
    });

    it('mizrahiIsLoggedIn returns true when element exists', async () => {
      const fn = MIZRAHI_CONFIG.possibleResults.success[1] as (opts: {
        page: Page;
      }) => Promise<boolean>;
      const page = makeMockPage();
      mockQueryAll.mockResolvedValue([{}]);
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
      mockQueryAll.mockResolvedValue([]);
      expect(await fn({ page })).toBe(false);
    });
  });

  describe('possibleResults.invalidPassword', () => {
    it('returns true when element present', async () => {
      const fn = MIZRAHI_CONFIG.possibleResults.invalidPassword![0] as (opts: {
        page: Page;
      }) => Promise<boolean>;
      const page = makeMockPage();
      mockQuery.mockResolvedValue({});
      expect(await fn({ page })).toBe(true);
    });

    it('returns false when element absent', async () => {
      const fn = MIZRAHI_CONFIG.possibleResults.invalidPassword![0] as (opts: {
        page: Page;
      }) => Promise<boolean>;
      const page = makeMockPage();
      mockQuery.mockResolvedValue(null);
      expect(await fn({ page })).toBe(false);
    });
  });
});
