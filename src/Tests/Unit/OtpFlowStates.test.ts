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

const OTP_MOD = await import('../../Common/OtpHandler.js');

/**
 * Creates a mock Playwright Page for OTP flow-state tests.
 * @returns A mock page with OTP-specific stubs.
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

/**
 * Flow-state validation for OTP handling.
 * Verifies EXACT output shapes: success results have NO errorType,
 * failure results HAVE errorType and errorMessage.
 */
describe('handleOtpStep — no OTP screen detected', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns { success: true } with NO errorType key', async () => {
    MOCK_DETECT_OTP_SCREEN.mockResolvedValue(false);
    const page = makeMockPage();
    const options = makeOptions();

    const result = await OTP_MOD.handleOtpStep(page, options);

    expect(result).toEqual({ success: true });
    expect(result).not.toHaveProperty('errorType');
    expect(result).not.toHaveProperty('errorMessage');
    expect(result.success).toBe(true);
  });
});

describe('handleOtpCode — no retriever configured', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns failure with TWO_FACTOR_RETRIEVER_MISSING errorType', async () => {
    const page = makeMockPage();
    const options = makeOptions();

    const result = await OTP_MOD.handleOtpCode(page, options);

    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.TwoFactorRetrieverMissing);
    expect(result).toHaveProperty('errorMessage');
    expect(typeof result.errorMessage).toBe('string');
  });

  it('failure shape: has success, errorType, and errorMessage — no extra keys', async () => {
    const page = makeMockPage();
    const options = makeOptions();

    const result = await OTP_MOD.handleOtpCode(page, options);

    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.TwoFactorRetrieverMissing,
    });
    const resultKeys = Object.keys(result);
    expect(resultKeys).toContain('success');
    expect(resultKeys).toContain('errorType');
    expect(resultKeys).toContain('errorMessage');
  });
});

describe('handleOtpCode — code accepted', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns { success: true } with NO errorType key', async () => {
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

    const result = await OTP_MOD.handleOtpCode(page, options, '******5100');

    expect(result).toEqual({ success: true });
    expect(result).not.toHaveProperty('errorType');
    expect(result).not.toHaveProperty('errorMessage');
    expect(result.success).toBe(true);
  });
});

describe('handleOtpCode — code rejected (OTP screen still visible)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns failure with INVALID_OTP errorType', async () => {
    const mockRetriever = jest.fn().mockResolvedValue('000000');
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

    const result = await OTP_MOD.handleOtpCode(page, options);

    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.InvalidOtp);
    expect(result).toHaveProperty('errorMessage');
  });

  it('errorMessage describes rejection reason', async () => {
    const mockRetriever = jest.fn().mockResolvedValue('000000');
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

    const result = await OTP_MOD.handleOtpCode(page, options);

    expect(result.errorMessage).toMatch(/rejected|expired|incorrectly/i);
  });

  it('failure shape has exactly success + errorType + errorMessage', async () => {
    const mockRetriever = jest.fn().mockResolvedValue('000000');
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

    const result = await OTP_MOD.handleOtpCode(page, options);

    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.InvalidOtp,
    });
    const keys = Object.keys(result);
    expect(keys).toContain('success');
    expect(keys).toContain('errorType');
    expect(keys).toContain('errorMessage');
  });
});

describe('handleOtpStep — full flow with retriever + OTP accepted', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns { success: true } when OTP detected and code accepted', async () => {
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

    const result = await OTP_MOD.handleOtpStep(page, options);

    expect(result).toEqual({ success: true });
    expect(result).not.toHaveProperty('errorType');
    expect(result).not.toHaveProperty('errorMessage');
  });
});
