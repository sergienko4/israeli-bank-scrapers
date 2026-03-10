import { jest } from '@jest/globals';
import type { Page } from 'playwright';

const MOCK_CAPTURE_PAGE_TEXT = jest.fn().mockResolvedValue('');
const MOCK_FILL = jest.fn().mockResolvedValue(undefined);
const MOCK_CLICK = jest.fn().mockResolvedValue(undefined);
const MOCK_WAIT_FOR = jest.fn().mockResolvedValue(undefined);
const MOCK_WAIT_FOR_URL = jest.fn().mockResolvedValue(undefined);

/**
 * Shared locator stub — created early so module mocks can reference it.
 */
const LOCATOR_STUB: Record<string, jest.Mock> = {
  first: jest.fn(),
  waitFor: MOCK_WAIT_FOR,
  fill: MOCK_FILL,
  click: MOCK_CLICK,
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

jest.unstable_mockModule(
  '../../Common/Debug.js',
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
  fillInput: jest.fn().mockResolvedValue(undefined),
  clickButton: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
  elementPresentOnPage: jest.fn().mockResolvedValue(false),
  capturePageText: MOCK_CAPTURE_PAGE_TEXT,
}));

jest.unstable_mockModule('../../Common/SelectorResolver.js', () => ({
  resolveFieldWithCache: jest.fn().mockResolvedValue({ isResolved: false }),
  resolveFieldContext: jest.fn().mockResolvedValue({ isResolved: false }),
  candidateToCss: jest.fn((c: { value: string }) => c.value),
  extractCredentialKey: jest.fn((s: string) => s),
  tryInContext: jest.fn().mockResolvedValue(null),
  toFirstCss: jest.fn(() => ''),
  resolveDashboardField: jest.fn().mockResolvedValue(null),
}));

jest.unstable_mockModule('../../Common/WellKnownLocators.js', () => ({
  wellKnownPlaceholder: jest.fn().mockReturnValue(LOCATOR_STUB),
  wellKnownSubmitButton: jest.fn().mockReturnValue(LOCATOR_STUB),
  findFormByField: jest.fn().mockReturnValue(LOCATOR_STUB),
}));

jest.unstable_mockModule('../../Common/Navigation.js', () => ({
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
  waitForNavigationAndDomLoad: jest.fn().mockResolvedValue(undefined),
  getCurrentUrl: jest.fn().mockResolvedValue('https://www.max.co.il'),
  waitForRedirect: jest.fn().mockResolvedValue(undefined),
  waitForUrl: jest.fn().mockResolvedValue(undefined),
}));

const { maxHandleSecondLoginStep: HANDLE_SECOND_LOGIN, detectIdVerification: DETECT_ID } =
  await import('../../Scrapers/Max/MaxLoginConfig.js');

/**
 * Creates a mock Page with getByPlaceholder/getByRole stubs.
 * @returns A mock Page instance.
 */
function makePage(): Page {
  MOCK_FILL.mockClear();
  MOCK_CLICK.mockClear();
  MOCK_WAIT_FOR.mockClear();
  return {
    url: jest.fn().mockReturnValue('https://www.max.co.il/login'),
    waitForURL: MOCK_WAIT_FOR_URL,
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    getByPlaceholder: jest.fn().mockReturnValue(LOCATOR_STUB),
    getByRole: jest.fn().mockReturnValue(LOCATOR_STUB),
    locator: jest.fn().mockReturnValue(LOCATOR_STUB),
    frames: jest.fn().mockReturnValue([]),
  } as unknown as Page;
}

describe('detectIdVerification', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns true when page text contains full indicator phrase', async () => {
    MOCK_CAPTURE_PAGE_TEXT.mockResolvedValue('נבקש למלא את מספר תעודת הזהות שלך');
    const page = makePage();
    expect(await DETECT_ID(page)).toBe(true);
  });

  it('returns true when page text contains partial indicator', async () => {
    MOCK_CAPTURE_PAGE_TEXT.mockResolvedValue('מלא את מספר תעודת הזהות');
    const page = makePage();
    expect(await DETECT_ID(page)).toBe(true);
  });

  it('returns true when page text contains short indicator', async () => {
    MOCK_CAPTURE_PAGE_TEXT.mockResolvedValue('שלום, תעודת הזהות נדרשת');
    const page = makePage();
    expect(await DETECT_ID(page)).toBe(true);
  });

  it('returns false when no indicator is present (Flow A)', async () => {
    MOCK_CAPTURE_PAGE_TEXT.mockResolvedValue('כניסה ללקוחות פרטיים');
    const page = makePage();
    expect(await DETECT_ID(page)).toBe(false);
  });

  it('returns false when page text is OTP-related only', async () => {
    MOCK_CAPTURE_PAGE_TEXT.mockResolvedValue('קוד חד פעמי שמקבלים לנייד');
    const page = makePage();
    expect(await DETECT_ID(page)).toBe(false);
  });

  it('returns false when page text is empty', async () => {
    MOCK_CAPTURE_PAGE_TEXT.mockResolvedValue('');
    const page = makePage();
    expect(await DETECT_ID(page)).toBe(false);
  });

  it('returns false when capturePageText fails', async () => {
    MOCK_CAPTURE_PAGE_TEXT.mockResolvedValue('(context unavailable)');
    const page = makePage();
    expect(await DETECT_ID(page)).toBe(false);
  });
});

describe('maxHandleSecondLoginStep', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns immediately when already on dashboard', async () => {
    const page = makePage();
    (page.url as jest.Mock).mockReturnValue('https://www.max.co.il/homepage/personal');
    const isSuccess = await HANDLE_SECOND_LOGIN(page, { username: 'u', password: 'p' });
    expect(isSuccess).toBe(true);
    expect(MOCK_FILL).not.toHaveBeenCalled();
  });

  it('no ID in credentials — skips ID prompt, waits for dashboard', async () => {
    const page = makePage();
    const isSuccess = await HANDLE_SECOND_LOGIN(page, { username: 'u', password: 'p' });
    expect(isSuccess).toBe(true);
    expect(MOCK_CAPTURE_PAGE_TEXT).not.toHaveBeenCalled();
    expect(MOCK_FILL).not.toHaveBeenCalled();
    expect(MOCK_WAIT_FOR_URL).toHaveBeenCalled();
  });

  it('no ID prompt detected — skips fill, waits for dashboard', async () => {
    MOCK_CAPTURE_PAGE_TEXT.mockResolvedValue('כניסה ללקוחות פרטיים');
    const page = makePage();
    const isSuccess = await HANDLE_SECOND_LOGIN(page, {
      username: 'u',
      password: 'p',
      id: '123456789',
    });
    expect(isSuccess).toBe(true);
    expect(MOCK_FILL).not.toHaveBeenCalled();
    expect(MOCK_WAIT_FOR_URL).toHaveBeenCalled();
  });

  it('ID prompt detected — fills ID+user+pass, submits, waits for dashboard', async () => {
    MOCK_CAPTURE_PAGE_TEXT.mockResolvedValue(
      'בשל מספר ניסיונות לא טובים, נבקש למלא את מספר תעודת הזהות שלך',
    );
    const page = makePage();
    const isSuccess = await HANDLE_SECOND_LOGIN(page, {
      username: 'testuser',
      password: 'testpass',
      id: '123456789',
    });
    expect(isSuccess).toBe(true);
    expect(MOCK_FILL).toHaveBeenCalledTimes(3);
    expect(MOCK_CLICK).toHaveBeenCalledTimes(1);
    expect(MOCK_WAIT_FOR_URL).toHaveBeenCalled();
  });
});
