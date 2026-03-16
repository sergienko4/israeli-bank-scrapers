import { jest } from '@jest/globals';
import type { Frame, Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../Scrapers/Base/Errors.js';
import type { ScraperOptions } from '../../Scrapers/Base/Interface.js';

const MOCK_EXTRACT_PHONE_HINT = jest.fn();
const MOCK_CLICK_OTP_TRIGGER_IF_PRESENT = jest.fn();
const MOCK_DETECT_OTP_SCREEN = jest.fn();
const MOCK_FILL_INPUT = jest.fn();
const MOCK_CLICK_BUTTON = jest.fn();
const MOCK_TRY_IN_CONTEXT = jest.fn();
const MOCK_RESOLVE_FIELD_CONTEXT = jest.fn();
const MOCK_CANDIDATE_TO_CSS = jest.fn((c: { value: string }) => c.value);

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
  candidateToCss: MOCK_CANDIDATE_TO_CSS,
  extractCredentialKey: jest.fn((selector: string) => selector),
  toFirstCss: jest.fn(() => ''),
  resolveDashboardField: jest.fn().mockResolvedValue(null),
}));

const OTP_HANDLER_MOD = await import('../../Common/OtpHandler.js');

/**
 * Creates a mock Playwright Frame with configurable OTP element responses.
 * @param selectorHits - Map of CSS selector to truthy element or null.
 * @returns A mock frame object.
 */
function makeMockFrame(selectorHits: Record<string, boolean> = {}): Frame {
  const mockEvaluate = jest.fn().mockResolvedValue(undefined);
  const mockElement = {
    evaluate: mockEvaluate,
  };
  return {
    $: jest.fn().mockImplementation((sel: string) => {
      return Promise.resolve(selectorHits[sel] ? mockElement : null);
    }),
    url: jest.fn().mockReturnValue('https://bank.test/otp-frame'),
    locator: jest.fn().mockReturnValue({
      first: jest.fn().mockReturnValue({
        pressSequentially: jest.fn().mockResolvedValue(undefined),
      }),
    }),
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
  } as unknown as Frame;
}

/**
 * Creates a mock Playwright Page with configurable frames.
 * @param frames - Array of frames the page should return.
 * @returns A mock page with the given frames.
 */
function makeMockPageWithFrames(frames: Frame[]): Page {
  const mainFrame = frames[0] ?? makeMockFrame();
  const emptyBuffer = Buffer.alloc(0);
  return {
    evaluate: jest.fn().mockResolvedValue('enter OTP code'),
    frames: jest.fn().mockReturnValue(frames),
    mainFrame: jest.fn().mockReturnValue(mainFrame),
    url: jest.fn().mockReturnValue('https://bank.test/otp'),
    screenshot: jest.fn().mockResolvedValue(emptyBuffer),
    click: jest.fn().mockResolvedValue(undefined),
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    frameLocator: jest.fn().mockReturnValue({
      locator: jest.fn().mockReturnValue({
        waitFor: jest.fn().mockRejectedValue(new Error('not found')),
      }),
    }),
  } as unknown as Page;
}

/**
 * Creates a basic mock page for simple tests.
 * @returns A mock page with a single frame.
 */
function makeMockPage(): Page {
  return makeMockPageWithFrames([makeMockFrame()]);
}

/**
 * Creates ScraperOptions with optional overrides.
 * @param overrides - Partial scraper options to merge.
 * @returns A complete ScraperOptions mock.
 */
function makeOptions(overrides: Partial<ScraperOptions> = {}): ScraperOptions {
  return { companyId: 'test', startDate: new Date(), ...overrides } as ScraperOptions;
}

// ── fillAndSubmitOtpCode: frame found path ──────────────────────────────────

describe('handleOtpCode — frame-based fill path', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fills OTP via frame when OTP input found in frame', async () => {
    const otpFrame = makeMockFrame({ '#codeinput': true });
    const page = makeMockPageWithFrames([otpFrame]);
    const mockRetriever = jest.fn().mockResolvedValue('654321');
    MOCK_EXTRACT_PHONE_HINT.mockResolvedValue('');
    MOCK_DETECT_OTP_SCREEN.mockResolvedValue(false);

    const options = makeOptions({ otpCodeRetriever: mockRetriever });
    const result = await OTP_HANDLER_MOD.handleOtpCode(page, options, 'hint');

    expect(mockRetriever).toHaveBeenCalledWith('hint');
    expect(result.success).toBe(true);
  });

  it('falls back to resolveFieldContext when no frame has OTP input', async () => {
    const emptyFrame = makeMockFrame();
    const page = makeMockPageWithFrames([emptyFrame]);
    const mockRetriever = jest.fn().mockResolvedValue('111111');
    MOCK_EXTRACT_PHONE_HINT.mockResolvedValue('');
    MOCK_DETECT_OTP_SCREEN.mockResolvedValue(false);
    MOCK_RESOLVE_FIELD_CONTEXT.mockResolvedValue({ selector: '#otp', context: emptyFrame });
    MOCK_TRY_IN_CONTEXT.mockResolvedValue(null);

    const options = makeOptions({ otpCodeRetriever: mockRetriever });
    const result = await OTP_HANDLER_MOD.handleOtpCode(page, options, '');

    expect(MOCK_RESOLVE_FIELD_CONTEXT).toHaveBeenCalled();
    expect(MOCK_FILL_INPUT).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('clicks submit button via resolver when submit selector found', async () => {
    const frame = makeMockFrame();
    const page = makeMockPageWithFrames([frame]);
    const mockRetriever = jest.fn().mockResolvedValue('222222');
    MOCK_EXTRACT_PHONE_HINT.mockResolvedValue('');
    MOCK_DETECT_OTP_SCREEN.mockResolvedValue(false);
    MOCK_RESOLVE_FIELD_CONTEXT.mockResolvedValue({ selector: '#otp', context: frame });
    MOCK_TRY_IN_CONTEXT.mockResolvedValue('button[type="submit"]');

    const options = makeOptions({ otpCodeRetriever: mockRetriever });
    const result = await OTP_HANDLER_MOD.handleOtpCode(page, options, '');

    expect(MOCK_CLICK_BUTTON).toHaveBeenCalledWith(frame, 'button[type="submit"]');
    expect(result.success).toBe(true);
  });
});

// ── buildMissingRetrieverResult edge cases ──────────────────────────────────

describe('handleOtpCode — buildMissingRetrieverResult', () => {
  beforeEach(() => jest.clearAllMocks());

  it('handles screenshot failure gracefully when screenshotDir set', async () => {
    const page = makeMockPage();
    (page.screenshot as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
    const options = makeOptions({ storeFailureScreenShotPath: '/tmp/shots' });

    const result = await OTP_HANDLER_MOD.handleOtpCode(page, options);

    expect(result.errorType).toBe(ScraperErrorTypes.TwoFactorRetrieverMissing);
    expect(result.errorMessage).not.toContain('Screenshot saved');
  });

  it('omits screenshot info when no screenshotDir configured', async () => {
    const page = makeMockPage();
    const options = makeOptions();

    const result = await OTP_HANDLER_MOD.handleOtpCode(page, options);

    expect(result.errorType).toBe(ScraperErrorTypes.TwoFactorRetrieverMissing);
    expect(result.errorMessage).toContain('otpCodeRetriever is not set');
    expect(result.errorMessage).not.toContain('Screenshot');
  });
});

// ── handleOtpCode — phoneHint extraction ────────────────────────────────────

describe('handleOtpCode — phoneHint fallback', () => {
  beforeEach(() => jest.clearAllMocks());

  it('extracts phoneHint from page when not provided as argument', async () => {
    const frame = makeMockFrame();
    const page = makeMockPageWithFrames([frame]);
    const mockRetriever = jest.fn().mockResolvedValue('333333');
    MOCK_EXTRACT_PHONE_HINT.mockResolvedValue('****9876');
    MOCK_DETECT_OTP_SCREEN.mockResolvedValue(false);
    MOCK_RESOLVE_FIELD_CONTEXT.mockResolvedValue({ selector: '#otp', context: frame });
    MOCK_TRY_IN_CONTEXT.mockResolvedValue(null);

    const options = makeOptions({ otpCodeRetriever: mockRetriever });
    const result = await OTP_HANDLER_MOD.handleOtpCode(page, options);

    expect(MOCK_EXTRACT_PHONE_HINT).toHaveBeenCalledWith(page);
    expect(mockRetriever).toHaveBeenCalledWith('****9876');
    expect(result.success).toBe(true);
  });
});

// ── handleOtpConfirm — with parsedPage ──────────────────────────────────────

describe('handleOtpConfirm — parsedPage childFrames', () => {
  beforeEach(() => jest.clearAllMocks());

  it('passes childFrames from parsedPage to clickOtpTriggerIfPresent', async () => {
    const childFrame = makeMockFrame();
    MOCK_EXTRACT_PHONE_HINT.mockResolvedValue('****1234');
    MOCK_CLICK_OTP_TRIGGER_IF_PRESENT.mockResolvedValue(undefined);

    const page = makeMockPage();
    const parsedPage = { childFrames: [childFrame] } as unknown as Parameters<
      typeof OTP_HANDLER_MOD.handleOtpConfirm
    >[1];

    const hint = await OTP_HANDLER_MOD.handleOtpConfirm(page, parsedPage);

    expect(hint).toBe('****1234');
    expect(MOCK_CLICK_OTP_TRIGGER_IF_PRESENT).toHaveBeenCalledWith(page, [childFrame]);
  });
});

// ── verifyOtpAccepted paths (via handleOtpCode) ────────────────────────────

describe('handleOtpCode — verifyOtpAccepted', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns InvalidOtp with descriptive message when OTP rejected', async () => {
    const frame = makeMockFrame();
    const page = makeMockPageWithFrames([frame]);
    const mockRetriever = jest.fn().mockResolvedValue('000000');
    MOCK_DETECT_OTP_SCREEN.mockResolvedValue(true);
    MOCK_RESOLVE_FIELD_CONTEXT.mockResolvedValue({ selector: '#otp', context: frame });
    MOCK_TRY_IN_CONTEXT.mockResolvedValue(null);

    const options = makeOptions({ otpCodeRetriever: mockRetriever });
    const result = await OTP_HANDLER_MOD.handleOtpCode(page, options, 'hint');

    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.InvalidOtp);
    expect(result.errorMessage).toContain('rejected');
  });

  it('returns success when OTP screen disappears after submission', async () => {
    const frame = makeMockFrame();
    const page = makeMockPageWithFrames([frame]);
    const mockRetriever = jest.fn().mockResolvedValue('777777');
    MOCK_DETECT_OTP_SCREEN.mockResolvedValue(false);
    MOCK_RESOLVE_FIELD_CONTEXT.mockResolvedValue({ selector: '#otp', context: frame });
    MOCK_TRY_IN_CONTEXT.mockResolvedValue(null);

    const options = makeOptions({ otpCodeRetriever: mockRetriever });
    const result = await OTP_HANDLER_MOD.handleOtpCode(page, options, 'hint');

    expect(result.success).toBe(true);
    expect(result.errorType).toBeUndefined();
  });
});
