import { jest } from '@jest/globals';
import type { Frame, Page } from 'playwright';

import { ScraperErrorTypes } from '../../Scrapers/Base/Errors.js';
import type { ScraperOptions } from '../../Scrapers/Base/Interface.js';

const MOCK_EXTRACT_PHONE_HINT = jest.fn();
const MOCK_CLICK_OTP_TRIGGER_IF_PRESENT = jest.fn();
const MOCK_DETECT_OTP_SCREEN = jest.fn();
const MOCK_FILL_INPUT = jest.fn();
const MOCK_CLICK_BUTTON = jest.fn();
const MOCK_TRY_IN_CONTEXT = jest.fn();
const MOCK_RESOLVE_FIELD_CONTEXT = jest.fn();

jest.unstable_mockModule('../../Common/Debug.js', () => ({
  /**
   * Creates a mock debug logger.
   * @returns A mock debug logger object.
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
  fillInput: MOCK_FILL_INPUT,
  clickButton: MOCK_CLICK_BUTTON,
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
  elementPresentOnPage: jest.fn().mockResolvedValue(false),
  capturePageText: jest.fn().mockResolvedValue(''),
}));

jest.unstable_mockModule('../../Common/OtpDetector.js', () => ({
  detectOtpScreen: MOCK_DETECT_OTP_SCREEN,
  extractPhoneHint: MOCK_EXTRACT_PHONE_HINT,
  clickOtpTriggerIfPresent: MOCK_CLICK_OTP_TRIGGER_IF_PRESENT,
  findOtpSubmitSelector: jest.fn().mockResolvedValue(null),
  clickFromCandidates: jest.fn().mockResolvedValue(false),
  OTP_SUBMIT_CANDIDATES: [{ kind: 'xpath' as const, value: '//button[contains(.,"send")]' }],
}));

jest.unstable_mockModule('../../Common/SelectorResolver.js', () => ({
  tryInContext: MOCK_TRY_IN_CONTEXT,
  resolveFieldWithCache: jest
    .fn()
    .mockResolvedValue({ isResolved: false, selector: '', context: {} }),
  resolveFieldContext: MOCK_RESOLVE_FIELD_CONTEXT,
  candidateToCss: jest.fn((candidate: { value: string }) => candidate.value),
  extractCredentialKey: jest.fn((selector: string) => selector),
  toFirstCss: jest.fn(() => ''),
  resolveDashboardField: jest.fn().mockResolvedValue(null),
}));

const OTP_HANDLER_MOD = await import('../../Common/OtpHandler.js');

/**
 * Creates a mock Playwright Page for OTP handler tests.
 * @returns A mock page with OTP-specific structure.
 */
function makeMockPage(): Page {
  const mainFrame = {
    $: jest.fn().mockResolvedValue(null),
    url: jest.fn().mockReturnValue('https://bank.test/otp'),
    locator: jest.fn().mockReturnValue({
      first: jest.fn().mockReturnValue({
        pressSequentially: jest.fn().mockResolvedValue(undefined),
      }),
    }),
  } as unknown as Frame;

  const emptyBuffer = Buffer.alloc(0);
  const notFoundError = new Error('not found');
  return {
    evaluate: jest.fn().mockResolvedValue('enter OTP code'),
    frames: jest.fn().mockReturnValue([mainFrame]),
    mainFrame: jest.fn().mockReturnValue(mainFrame),
    url: jest.fn().mockReturnValue('https://bank.test/otp'),
    screenshot: jest.fn().mockResolvedValue(emptyBuffer),
    click: jest.fn().mockResolvedValue(undefined),
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    frameLocator: jest.fn().mockReturnValue({
      locator: jest.fn().mockReturnValue({
        waitFor: jest.fn().mockRejectedValue(notFoundError),
      }),
    }),
  } as unknown as Page;
}

/**
 * Creates a mock ScraperOptions object with optional overrides.
 * @param overrides - Partial scraper options to merge.
 * @returns A complete ScraperOptions mock.
 */
function makeOptions(overrides: Partial<ScraperOptions> = {}): ScraperOptions {
  return {
    companyId: 'test',
    startDate: new Date(),
    ...overrides,
  } as ScraperOptions;
}

describe('handleOtpConfirm', () => {
  beforeEach(() => jest.clearAllMocks());

  it('extracts phone hint and clicks SMS trigger', async () => {
    MOCK_EXTRACT_PHONE_HINT.mockResolvedValue('******5100');
    MOCK_CLICK_OTP_TRIGGER_IF_PRESENT.mockResolvedValue(undefined);
    const page = makeMockPage();

    const hint = await OTP_HANDLER_MOD.handleOtpConfirm(page);

    expect(hint).toBe('******5100');
    expect(MOCK_EXTRACT_PHONE_HINT).toHaveBeenCalledWith(page);
    expect(MOCK_CLICK_OTP_TRIGGER_IF_PRESENT).toHaveBeenCalledWith(page, undefined);
  });

  it('returns empty string when no phone hint found', async () => {
    MOCK_EXTRACT_PHONE_HINT.mockResolvedValue('');
    MOCK_CLICK_OTP_TRIGGER_IF_PRESENT.mockResolvedValue(undefined);

    const page = makeMockPage();
    const hint = await OTP_HANDLER_MOD.handleOtpConfirm(page);

    expect(hint).toBe('');
  });
});

describe('handleOtpCode', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns TwoFactorRetrieverMissing when no otpCodeRetriever', async () => {
    const page = makeMockPage();
    const options = makeOptions();

    const result = await OTP_HANDLER_MOD.handleOtpCode(page, options);

    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      errorType: ScraperErrorTypes.TwoFactorRetrieverMissing,
      success: false,
    });
  });

  it('returns TwoFactorRetrieverMissing with screenshot path when screenshotDir set', async () => {
    const page = makeMockPage();
    const options = makeOptions({ storeFailureScreenShotPath: '/tmp/screenshots' });

    const result = await OTP_HANDLER_MOD.handleOtpCode(page, options);

    expect(result).toMatchObject({
      errorType: ScraperErrorTypes.TwoFactorRetrieverMissing,
    });
    const errorMessage = (result as unknown as Record<string, string>).errorMessage;
    expect(errorMessage).toContain('Screenshot saved to');
  });

  it('calls otpCodeRetriever with phone hint and fills code', async () => {
    const mockRetriever = jest.fn().mockResolvedValue('123456');
    MOCK_EXTRACT_PHONE_HINT.mockResolvedValue('******5100');
    MOCK_DETECT_OTP_SCREEN.mockResolvedValue(false);
    const mockMainFrame = makeMockPage().mainFrame();
    MOCK_RESOLVE_FIELD_CONTEXT.mockResolvedValue({
      selector: '#otpCode',
      context: mockMainFrame,
    });
    MOCK_TRY_IN_CONTEXT.mockResolvedValue(null);

    const page = makeMockPage();
    const options = makeOptions({ otpCodeRetriever: mockRetriever });

    const result = await OTP_HANDLER_MOD.handleOtpCode(page, options, '******5100');

    expect(mockRetriever).toHaveBeenCalledWith('******5100');
    expect(result).toMatchObject({ success: true });
  });

  it('returns InvalidOtp when OTP screen still visible after submission', async () => {
    const mockRetriever = jest.fn().mockResolvedValue('123456').mockResolvedValue('999999');
    MOCK_EXTRACT_PHONE_HINT.mockResolvedValue('');
    MOCK_DETECT_OTP_SCREEN.mockResolvedValue(true);
    const mockMainFrame = makeMockPage().mainFrame();
    MOCK_RESOLVE_FIELD_CONTEXT.mockResolvedValue({
      selector: '#otpCode',
      context: mockMainFrame,
    });
    MOCK_TRY_IN_CONTEXT.mockResolvedValue(null);

    const page = makeMockPage();
    const options = makeOptions({ otpCodeRetriever: mockRetriever });

    const result = await OTP_HANDLER_MOD.handleOtpCode(page, options);

    expect(result).toMatchObject({
      errorType: ScraperErrorTypes.InvalidOtp,
      success: false,
    });
  });
});

describe('handleOtpStep', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns success when no OTP screen detected', async () => {
    MOCK_DETECT_OTP_SCREEN.mockResolvedValue(false);

    const page = makeMockPage();
    const options = makeOptions();
    const result = await OTP_HANDLER_MOD.handleOtpStep(page, options);

    expect(result).toMatchObject({ success: true });
    expect(MOCK_DETECT_OTP_SCREEN).toHaveBeenCalled();
  });

  it('detects OTP and calls handleOtpConfirm + handleOtpCode', async () => {
    MOCK_DETECT_OTP_SCREEN.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    MOCK_EXTRACT_PHONE_HINT.mockResolvedValue('******5100');
    MOCK_CLICK_OTP_TRIGGER_IF_PRESENT.mockResolvedValue(undefined);
    const mockMainFrame = makeMockPage().mainFrame();
    MOCK_RESOLVE_FIELD_CONTEXT.mockResolvedValue({
      selector: '#otpCode',
      context: mockMainFrame,
    });
    MOCK_TRY_IN_CONTEXT.mockResolvedValue(null);

    const mockRetriever = jest.fn().mockResolvedValue('123456');
    const page = makeMockPage();
    const options = makeOptions({ otpCodeRetriever: mockRetriever });

    const result = await OTP_HANDLER_MOD.handleOtpStep(page, options);

    expect(MOCK_EXTRACT_PHONE_HINT).toHaveBeenCalled();
    expect(MOCK_CLICK_OTP_TRIGGER_IF_PRESENT).toHaveBeenCalled();
    expect(mockRetriever).toHaveBeenCalledWith('******5100');
    expect(result).toMatchObject({ success: true });
  });

  it('returns TwoFactorRetrieverMissing when OTP detected but no retriever', async () => {
    MOCK_DETECT_OTP_SCREEN.mockResolvedValue(true);
    MOCK_EXTRACT_PHONE_HINT.mockResolvedValue('');
    MOCK_CLICK_OTP_TRIGGER_IF_PRESENT.mockResolvedValue(undefined);

    const page = makeMockPage();
    const options = makeOptions();
    const result = await OTP_HANDLER_MOD.handleOtpStep(page, options);

    expect(result).toMatchObject({
      errorType: ScraperErrorTypes.TwoFactorRetrieverMissing,
    });
  });
});
