import { jest } from '@jest/globals';
import type { Frame, Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../Scrapers/Base/Errors.js';
import type { ScraperOptions } from '../../Scrapers/Base/Interface.js';

const MOCK_EXTRACT_PHONE_HINT = jest.fn();
const MOCK_CLICK_OTP_TRIGGER = jest.fn();
const MOCK_DETECT_OTP_SCREEN = jest.fn();
const MOCK_FILL_INPUT = jest.fn();
const MOCK_CLICK_BUTTON = jest.fn();
const MOCK_TRY_IN_CONTEXT = jest.fn();
const MOCK_RESOLVE_FIELD = jest.fn();
const MOCK_CANDIDATE_TO_CSS = jest.fn((c: { value: string }) => c.value);
const MOCK_CLICK_FROM_CANDIDATES = jest.fn();

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
  clickOtpTriggerIfPresent: MOCK_CLICK_OTP_TRIGGER,
  findOtpSubmitSelector: jest.fn().mockResolvedValue(null),
  clickFromCandidates: MOCK_CLICK_FROM_CANDIDATES,
  OTP_SUBMIT_CANDIDATES: [{ kind: 'xpath' as const, value: '//button[contains(.,"send")]' }],
}));

jest.unstable_mockModule('../../Common/SelectorResolver.js', () => ({
  tryInContext: MOCK_TRY_IN_CONTEXT,
  resolveFieldWithCache: jest
    .fn()
    .mockResolvedValue({ isResolved: false, selector: '', context: {} }),
  resolveFieldContext: MOCK_RESOLVE_FIELD,
  candidateToCss: MOCK_CANDIDATE_TO_CSS,
  extractCredentialKey: jest.fn((s: string) => s),
  resolveDashboardField: jest.fn().mockResolvedValue(null),
}));

const OTP_MOD = await import('../../Common/OtpHandler.js');

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Creates a mock element handle for OTP submit/input.
 * @returns A mock element with evaluate stub.
 */
function makeMockElement(): { evaluate: jest.Mock } {
  return { evaluate: jest.fn().mockResolvedValue(true) };
}

/**
 * Creates a mock frame with configurable OTP element and locator behavior.
 * @param opts - Configuration for frame behavior.
 * @param opts.selectorHits - Map of selectors to whether they return a hit.
 * @param opts.locatorThrows - Whether the locator should throw.
 * @param opts.bodyText - Text returned by frame.evaluate.
 * @returns A mock Frame.
 */
function makeFrame(
  opts: {
    selectorHits?: Record<string, boolean>;
    locatorThrows?: boolean;
    bodyText?: string;
  } = {},
): Frame {
  const {
    selectorHits = {},
    locatorThrows: shouldThrow = false,
    bodyText = 'סיסמה חד פעמית',
  } = opts;
  const mockEl = makeMockElement();
  const pressSeq = shouldThrow
    ? jest.fn().mockRejectedValue(new Error('locator broke'))
    : jest.fn().mockResolvedValue(undefined);
  return {
    $: jest.fn().mockImplementation((sel: string) => {
      return Promise.resolve(selectorHits[sel] ? mockEl : null);
    }),
    url: jest.fn().mockReturnValue('https://bank.test/otp-frame'),
    evaluate: jest.fn().mockResolvedValue(bodyText),
    locator: jest.fn().mockReturnValue({
      first: jest.fn().mockReturnValue({ pressSequentially: pressSeq }),
    }),
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
  } as unknown as Frame;
}

/**
 * Creates a mock page wrapping the given frames.
 * @param frames - Array of frames the page returns.
 * @returns A mock Page.
 */
function makePage(frames: Frame[]): Page {
  const main = frames[0] ?? makeFrame();
  const emptyBuffer = Buffer.alloc(0);
  return {
    evaluate: jest.fn().mockResolvedValue(''),
    frames: jest.fn().mockReturnValue(frames),
    mainFrame: jest.fn().mockReturnValue(main),
    url: jest.fn().mockReturnValue('https://bank.test/otp'),
    screenshot: jest.fn().mockResolvedValue(emptyBuffer),
    click: jest.fn().mockResolvedValue(undefined),
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    frameLocator: jest.fn().mockReturnValue({
      locator: jest.fn().mockReturnValue({
        waitFor: jest.fn().mockRejectedValue(new Error('nope')),
      }),
    }),
  } as unknown as Page;
}

/**
 * Creates ScraperOptions with optional overrides.
 * @param overrides - Partial options to merge.
 * @returns A ScraperOptions mock.
 */
function makeOpts(overrides: Partial<ScraperOptions> = {}): ScraperOptions {
  return { companyId: 'test', startDate: new Date(), ...overrides } as ScraperOptions;
}

// ── handleOtpConfirm with triggerSelectors ───────────────────────────────────

describe('handleOtpConfirm — triggerSelectors branch', () => {
  beforeEach(() => jest.clearAllMocks());

  it('clicks bank-specific confirm button when triggerSelectors provided', async () => {
    MOCK_EXTRACT_PHONE_HINT.mockResolvedValue('****5555');
    MOCK_CLICK_FROM_CANDIDATES.mockResolvedValue(true);
    MOCK_CLICK_OTP_TRIGGER.mockResolvedValue(undefined);
    const defaultFrame = makeFrame();
    const page = makePage([defaultFrame]);
    const triggers = [{ kind: 'css' as const, value: '#confirmBtn' }];

    const hint = await OTP_MOD.handleOtpConfirm(page, undefined, triggers);

    expect(hint).toBe('****5555');
    expect(MOCK_CLICK_FROM_CANDIDATES).toHaveBeenCalledWith(page, triggers, undefined);
  });

  it('passes childFrames from parsedPage with triggerSelectors', async () => {
    MOCK_EXTRACT_PHONE_HINT.mockResolvedValue('****7777');
    MOCK_CLICK_FROM_CANDIDATES.mockResolvedValue(true);
    MOCK_CLICK_OTP_TRIGGER.mockResolvedValue(undefined);
    const child = makeFrame();
    const mainFrame = makeFrame();
    const page = makePage([mainFrame]);
    const parsed = { childFrames: [child] } as unknown as Parameters<
      typeof OTP_MOD.handleOtpConfirm
    >[1];
    const triggers = [{ kind: 'xpath' as const, value: '//button[@id="confirm"]' }];

    await OTP_MOD.handleOtpConfirm(page, parsed, triggers);

    expect(MOCK_CLICK_FROM_CANDIDATES).toHaveBeenCalledWith(page, triggers, [child]);
  });
});

// ── typeOtpIntoField catch + injectOtpViaEvaluate ────────────────────────────

describe('handleOtpCode — locator fallback to evaluate injection', () => {
  beforeEach(() => jest.clearAllMocks());

  it('falls back to injectOtpViaEvaluate when pressSequentially throws', async () => {
    const frame = makeFrame({ selectorHits: { '#codeinput': true }, locatorThrows: true });
    const page = makePage([frame]);
    const retriever = jest.fn().mockResolvedValue('123456');
    MOCK_EXTRACT_PHONE_HINT.mockResolvedValue('');
    MOCK_DETECT_OTP_SCREEN.mockResolvedValue(false);

    const opts = makeOpts({ otpCodeRetriever: retriever });
    const result = await OTP_MOD.handleOtpCode(page, opts, 'h');

    expect(retriever).toHaveBeenCalledWith('h');
    expect(result.success).toBe(true);
    const mockResults = (frame.$ as jest.Mock).mock.results;
    const frameEl = await (mockResults[0] as { value: Promise<{ evaluate: jest.Mock }> }).value;
    expect(frameEl.evaluate).toHaveBeenCalled();
  });
});

// ── submitOtpInFrame — submit button found path ─────────────────────────────

describe('handleOtpCode — OTP submit button found in frame', () => {
  beforeEach(() => jest.clearAllMocks());

  it('clicks OTP submit button when candidate matches in frame', async () => {
    const submitSel = '//button[contains(.,"send")]';
    const frame = makeFrame({ selectorHits: { '#codeinput': true, [submitSel]: true } });
    const page = makePage([frame]);
    const retriever = jest.fn().mockResolvedValue('654321');
    MOCK_EXTRACT_PHONE_HINT.mockResolvedValue('');
    MOCK_DETECT_OTP_SCREEN.mockResolvedValue(false);

    const opts = makeOpts({ otpCodeRetriever: retriever });
    const result = await OTP_MOD.handleOtpCode(page, opts, 'x');

    expect(result.success).toBe(true);
    const frameQueryMock = (frame as unknown as { $: jest.Mock }).$;
    expect(frameQueryMock).toHaveBeenCalled();
  });
});

// ── handleOtpCode — OTP rejected (InvalidOtp) ──────────────────────────────

describe('handleOtpCode — verifyOtpAccepted rejected path', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns InvalidOtp when OTP screen persists after code entry via frame', async () => {
    const frame = makeFrame({ selectorHits: { '#codeinput': true } });
    const page = makePage([frame]);
    const retriever = jest.fn().mockResolvedValue('000000');
    MOCK_DETECT_OTP_SCREEN.mockResolvedValue(true);

    const opts = makeOpts({ otpCodeRetriever: retriever });
    const result = await OTP_MOD.handleOtpCode(page, opts, 'h');

    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.InvalidOtp);
  });
});
