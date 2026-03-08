import { jest } from '@jest/globals';
import type { Page } from 'playwright';

const mockResolveFieldContext = jest.fn();
const mockFillInput = jest.fn().mockResolvedValue(undefined);
const mockClickButton = jest.fn().mockResolvedValue(undefined);
const mockElementPresentOnPage = jest.fn().mockResolvedValue(false);
const mockWaitUntilElementFound = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('../../Common/Debug.js', () => ({
  getDebug: () => ({
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

jest.unstable_mockModule('../../Common/Waiting.js', () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
  humanDelay: jest.fn().mockResolvedValue(undefined),
  waitUntil: jest.fn().mockResolvedValue(undefined),
  raceTimeout: jest.fn().mockResolvedValue(undefined),
  runSerial: jest.fn().mockResolvedValue([]),
  TimeoutError: class TimeoutError extends Error {},
  SECOND: 1000,
}));

jest.unstable_mockModule('../../Common/ElementsInteractions.js', () => ({
  fillInput: mockFillInput,
  clickButton: mockClickButton,
  waitUntilElementFound: mockWaitUntilElementFound,
  elementPresentOnPage: mockElementPresentOnPage,
  capturePageText: jest.fn().mockResolvedValue(''),
}));

jest.unstable_mockModule('../../Common/SelectorResolver.js', () => ({
  resolveFieldWithCache: jest
    .fn()
    .mockResolvedValue({ isResolved: false, selector: '', context: {} }),
  resolveFieldContext: mockResolveFieldContext,
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

const { maxHandleSecondLoginStep, MAX_CONFIG } =
  await import('../../Scrapers/Max/MaxLoginConfig.js');

const mockPageEval = jest.fn().mockResolvedValue(undefined);
const mockWaitForSelector = jest.fn().mockResolvedValue(undefined);
const mockWaitForURL = jest.fn().mockResolvedValue(undefined);
const mockLocator = jest.fn().mockReturnValue({
  first: jest.fn().mockReturnValue({
    isVisible: jest.fn().mockResolvedValue(true),
    click: jest.fn().mockResolvedValue(undefined),
    count: jest.fn().mockResolvedValue(1),
  }),
});

function makeMockPage(url = 'https://www.max.co.il/login'): Page {
  mockPageEval.mockClear();
  mockWaitForSelector.mockClear();
  mockWaitForURL.mockClear();
  mockLocator.mockClear();
  return {
    url: jest.fn().mockReturnValue(url),
    $eval: mockPageEval,
    waitForSelector: mockWaitForSelector,
    waitForURL: mockWaitForURL,
    locator: mockLocator,
  } as unknown as Page;
}

describe('maxHandleSecondLoginStep', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is a no-op when credentials.id is not provided', async () => {
    const page = makeMockPage();
    await maxHandleSecondLoginStep(page, { username: 'user', password: 'pass' });
    expect(mockResolveFieldContext).not.toHaveBeenCalled();
    expect(mockFillInput).not.toHaveBeenCalled();
  });

  it('is a no-op when ID field is not found (Flow A)', async () => {
    mockResolveFieldContext.mockResolvedValue({ isResolved: false });
    const page = makeMockPage();
    await maxHandleSecondLoginStep(page, { username: 'user', password: 'pass', id: '123456789' });
    expect(mockResolveFieldContext).toHaveBeenCalled();
    expect(mockFillInput).not.toHaveBeenCalled();
  });

  it('fills username, password, and ID when ID field is found (Flow B)', async () => {
    const mockContext = {} as Page;
    const page = makeMockPage();
    mockResolveFieldContext
      .mockResolvedValueOnce({ isResolved: true, selector: '#id-field', context: mockContext })
      .mockResolvedValueOnce({ isResolved: true, selector: '#user-name', context: page })
      .mockResolvedValueOnce({ isResolved: true, selector: '#password', context: page });
    await maxHandleSecondLoginStep(page, {
      username: 'testuser',
      password: 'testpass',
      id: '123456789',
    });
    expect(mockResolveFieldContext).toHaveBeenCalledTimes(3);
    expect(mockFillInput).toHaveBeenCalledTimes(3);
    expect(mockClickButton).toHaveBeenCalled();
  });

  it('skips username fill when username resolution fails in Flow B', async () => {
    const mockContext = {} as Page;
    const page = makeMockPage();
    mockResolveFieldContext
      .mockResolvedValueOnce({ isResolved: true, selector: '#id-field', context: mockContext })
      .mockResolvedValueOnce({ isResolved: false })
      .mockResolvedValueOnce({ isResolved: true, selector: '#password', context: page });
    await maxHandleSecondLoginStep(page, { username: 'u', password: 'p', id: '123' });
    expect(mockFillInput).toHaveBeenCalledTimes(2);
    expect(mockClickButton).toHaveBeenCalled();
  });

  it('skips password fill when password resolution fails in Flow B', async () => {
    const mockContext = {} as Page;
    const page = makeMockPage();
    mockResolveFieldContext
      .mockResolvedValueOnce({ isResolved: true, selector: '#id-field', context: mockContext })
      .mockResolvedValueOnce({ isResolved: true, selector: '#user-name', context: page })
      .mockResolvedValueOnce({ isResolved: false });
    await maxHandleSecondLoginStep(page, { username: 'u', password: 'p', id: '123' });
    expect(mockFillInput).toHaveBeenCalledTimes(2);
    expect(mockClickButton).toHaveBeenCalled();
  });

  it('fills only ID when both username and password resolution fail', async () => {
    const mockContext = {} as Page;
    const page = makeMockPage();
    mockResolveFieldContext
      .mockResolvedValueOnce({ isResolved: true, selector: '#id-field', context: mockContext })
      .mockResolvedValueOnce({ isResolved: false })
      .mockResolvedValueOnce({ isResolved: false });
    await maxHandleSecondLoginStep(page, { username: 'u', password: 'p', id: '123' });
    expect(mockFillInput).toHaveBeenCalledTimes(1);
    expect(mockClickButton).toHaveBeenCalled();
  });

  it('passes correct FieldConfig to resolveFieldContext for each field', async () => {
    const mockContext = {} as Page;
    const page = makeMockPage();
    mockResolveFieldContext
      .mockResolvedValueOnce({ isResolved: true, selector: '#id', context: mockContext })
      .mockResolvedValueOnce({ isResolved: true, selector: '#u', context: page })
      .mockResolvedValueOnce({ isResolved: true, selector: '#p', context: page });
    await maxHandleSecondLoginStep(page, { username: 'u', password: 'p', id: '123' });
    expect(mockResolveFieldContext).toHaveBeenNthCalledWith(
      1,
      page,
      expect.objectContaining({ credentialKey: 'id', selectors: [] }),
      expect.any(String),
    );
    expect(mockResolveFieldContext).toHaveBeenNthCalledWith(
      2,
      page,
      expect.objectContaining({ credentialKey: 'username', selectors: [] }),
      expect.any(String),
    );
    expect(mockResolveFieldContext).toHaveBeenNthCalledWith(
      3,
      page,
      expect.objectContaining({ credentialKey: 'password', selectors: [] }),
      expect.any(String),
    );
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
    expect(Array.isArray(MAX_CONFIG.submit) ? MAX_CONFIG.submit.length : 1).toBeGreaterThan(0);
  });

  describe('possibleResults.success', () => {
    it('returns true when URL starts with homepage', () => {
      const fn = MAX_CONFIG.possibleResults.success[0] as (opts: {
        page?: { url(): string };
      }) => boolean;
      expect(fn({ page: { url: () => 'https://www.max.co.il/homepage/personal' } })).toBe(true);
    });

    it('returns false when URL is not homepage', () => {
      const fn = MAX_CONFIG.possibleResults.success[0] as (opts: {
        page?: { url(): string };
      }) => boolean;
      expect(fn({ page: { url: () => 'https://www.max.co.il/login' } })).toBe(false);
    });
  });

  describe('possibleResults.invalidPassword', () => {
    it('returns true when popupWrongDetails element present', async () => {
      mockElementPresentOnPage.mockResolvedValue(true);
      const fn = MAX_CONFIG.possibleResults.invalidPassword![0] as (opts: {
        page: Page;
      }) => Promise<boolean>;
      const result = await fn({ page: makeMockPage() });
      expect(result).toBe(true);
    });

    it('returns false when popupWrongDetails element absent', async () => {
      mockElementPresentOnPage.mockResolvedValue(false);
      const fn = MAX_CONFIG.possibleResults.invalidPassword![0] as (opts: {
        page: Page;
      }) => Promise<boolean>;
      const result = await fn({ page: makeMockPage() });
      expect(result).toBe(false);
    });
  });

  describe('possibleResults.unknownError', () => {
    it('returns true when popupCardHoldersLoginError present', async () => {
      mockElementPresentOnPage.mockResolvedValue(true);
      const fn = MAX_CONFIG.possibleResults.unknownError![0] as (opts: {
        page: Page;
      }) => Promise<boolean>;
      const result = await fn({ page: makeMockPage() });
      expect(result).toBe(true);
    });
  });

  describe('checkReadiness', () => {
    it('waits for login button to be visible', async () => {
      await MAX_CONFIG.checkReadiness!(makeMockPage());
      expect(mockWaitForSelector).toHaveBeenCalledWith(
        expect.stringContaining('כניסה'),
        expect.objectContaining({ state: 'visible' }),
      );
    });
  });

  describe('preAction', () => {
    it('clicks navigation buttons and waits for username input', async () => {
      mockElementPresentOnPage.mockResolvedValue(false);
      const result = await MAX_CONFIG.preAction!(makeMockPage());
      expect(result).toBeUndefined();
      expect(mockLocator).toHaveBeenCalled();
    });

    it('closes popup if present before navigating', async () => {
      mockElementPresentOnPage.mockResolvedValue(true);
      await MAX_CONFIG.preAction!(makeMockPage());
      expect(mockPageEval).toHaveBeenCalledWith('#closePopup', expect.any(Function));
    });
  });

  describe('postAction', () => {
    it('returns immediately when already on homepage', async () => {
      await MAX_CONFIG.postAction!(makeMockPage('https://www.max.co.il/homepage/personal'));
      expect(mockWaitForURL).not.toHaveBeenCalled();
    });

    it('waits for homepage or error popup when not on homepage', async () => {
      await MAX_CONFIG.postAction!(makeMockPage('https://www.max.co.il/login'));
      expect(mockWaitForURL).toHaveBeenCalled();
    });
  });
});
