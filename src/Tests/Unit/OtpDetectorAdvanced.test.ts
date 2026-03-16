import { jest } from '@jest/globals';
import type { Frame, Page } from 'playwright-core';

const MOCK_TRY_IN_CONTEXT = jest.fn();

jest.unstable_mockModule('../../Common/Debug.js', () => ({
  /**
   * Creates a mock debug logger with all methods stubbed.
   * @returns Mock debug logger object.
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

jest.unstable_mockModule('../../Common/SelectorResolver.js', () => ({
  /**
   * Delegates to the shared mock for tryInContext.
   * @param args - Arguments forwarded to the mock.
   * @returns Delegated mock result from MOCK_TRY_IN_CONTEXT.
   */
  tryInContext: (...args: unknown[]): unknown => MOCK_TRY_IN_CONTEXT(...args),
  candidateToCss: jest.fn((candidate: { value: string }) => candidate.value),
  resolveFieldContext: jest.fn().mockResolvedValue(null),
  resolveFieldWithCache: jest.fn().mockResolvedValue(null),
  extractCredentialKey: jest.fn((selector: string) => selector),
  resolveDashboardField: jest.fn().mockResolvedValue(null),
}));

const OTP_MODULE = await import('../../Common/OtpDetector.js');

/** Mock frame interface exposing jest.Mock-typed methods for assertion. */
interface IMockFrame extends Frame {
  $: jest.Mock;
  url: jest.Mock;
  click: jest.Mock;
}

/** Mock page interface exposing jest.Mock-typed methods for assertion. */
interface IMockPage extends Page {
  evaluate: jest.Mock;
  frames: jest.Mock;
  mainFrame: jest.Mock;
  url: jest.Mock;
  click: jest.Mock;
}

/**
 * Creates a mock Playwright Frame with jest.Mock-typed methods.
 * @param url - URL the frame reports.
 * @returns A mock frame object.
 */
function makeMockFrame(url = 'https://bank.test/child'): IMockFrame {
  return {
    $: jest.fn().mockResolvedValue(null),
    url: jest.fn().mockReturnValue(url),
    click: jest.fn().mockResolvedValue(undefined),
  } as unknown as IMockFrame;
}

/**
 * Creates a mock page with configurable body text and frames.
 * @param bodyText - Text returned by page.evaluate.
 * @param childFrames - Optional child frames to include.
 * @returns A mock page cast as IMockPage.
 */
function makePage(bodyText?: string, childFrames: Frame[] = []): IMockPage {
  const mainFrame = makeMockFrame('https://bank.test');
  const allFrames = [mainFrame, ...childFrames];
  return {
    evaluate: jest.fn().mockResolvedValue(bodyText),
    frames: jest.fn().mockReturnValue(allFrames),
    mainFrame: jest.fn().mockReturnValue(mainFrame),
    url: jest.fn().mockReturnValue('https://bank.test'),
    click: jest.fn().mockResolvedValue(undefined),
    frameLocator: jest.fn().mockReturnValue({
      locator: jest.fn().mockReturnValue({
        waitFor: jest.fn().mockRejectedValue(new Error('not found')),
        hover: jest.fn(),
        click: jest.fn(),
      }),
    }),
  } as unknown as IMockPage;
}

// ── detectByInputField — no input found anywhere ────────────────────────────

describe('detectOtpScreen — input field edge cases', () => {
  beforeEach(() => MOCK_TRY_IN_CONTEXT.mockResolvedValue(null));

  it('returns false when text is clear and no input in page or child frames', async () => {
    const childFrame = makeMockFrame('https://bank.test/iframe');
    const page = makePage('Welcome to banking', [childFrame]);
    MOCK_TRY_IN_CONTEXT.mockResolvedValue(null);

    const isOtp = await OTP_MODULE.detectOtpScreen(page);

    expect(isOtp).toBe(false);
    expect(MOCK_TRY_IN_CONTEXT).toHaveBeenCalledTimes(2);
  });

  it('returns true when input found in child frame but not main page', async () => {
    const childFrame = makeMockFrame('https://bank.test/otp-iframe');
    const page = makePage('Welcome', [childFrame]);
    MOCK_TRY_IN_CONTEXT.mockResolvedValueOnce(null).mockResolvedValueOnce('[name="otpCode"]');

    const isOtp = await OTP_MODULE.detectOtpScreen(page);

    expect(isOtp).toBe(true);
  });

  it('returns true for "one-time password" English text pattern', async () => {
    const page = makePage('Please enter your one-time password below');

    const isOtp = await OTP_MODULE.detectOtpScreen(page);

    expect(isOtp).toBe(true);
    expect(MOCK_TRY_IN_CONTEXT).not.toHaveBeenCalled();
  });

  it('returns true for "SMS code" English text pattern', async () => {
    const page = makePage('Enter the SMS code we sent');

    const isOtp = await OTP_MODULE.detectOtpScreen(page);

    expect(isOtp).toBe(true);
  });

  it('returns true for Hebrew "קוד אימות" pattern', async () => {
    const page = makePage('הזן קוד אימות שקיבלת');

    const isOtp = await OTP_MODULE.detectOtpScreen(page);

    expect(isOtp).toBe(true);
  });

  it('returns true for "שלח קוד" pattern', async () => {
    const page = makePage('לחץ כאן כדי שלח קוד');

    const isOtp = await OTP_MODULE.detectOtpScreen(page);

    expect(isOtp).toBe(true);
  });

  it('returns true for "בחר טלפון" pattern', async () => {
    const page = makePage('בחר טלפון לקבלת הקוד');

    const isOtp = await OTP_MODULE.detectOtpScreen(page);

    expect(isOtp).toBe(true);
  });
});

// ── detectOtpScreen — getBodyText error handling ────────────────────────────

describe('detectOtpScreen — evaluate failure', () => {
  beforeEach(() => MOCK_TRY_IN_CONTEXT.mockResolvedValue(null));

  it('returns false when page.evaluate throws (page context destroyed)', async () => {
    const page = makePage(undefined);
    page.evaluate.mockRejectedValueOnce(new Error('context destroyed'));

    const isOtp = await OTP_MODULE.detectOtpScreen(page);

    expect(isOtp).toBe(false);
    expect(MOCK_TRY_IN_CONTEXT).not.toHaveBeenCalled();
  });
});

// ── extractPhoneHint — additional edge cases ────────────────────────────────

describe('extractPhoneHint — edge cases', () => {
  it('extracts phone hint with many asterisks', async () => {
    const page = makePage('הקוד נשלח ל-********12');

    const hint = await OTP_MODULE.extractPhoneHint(page);

    expect(hint).toBe('********12');
  });

  it('extracts first match when multiple phone patterns present', async () => {
    const page = makePage('טלפון 1: ****5100 טלפון 2: ****9999');

    const hint = await OTP_MODULE.extractPhoneHint(page);

    expect(hint).toBe('****5100');
  });

  it('returns empty string when evaluate throws', async () => {
    const page = makePage(undefined);
    page.evaluate.mockRejectedValueOnce(new Error('detached'));

    const hint = await OTP_MODULE.extractPhoneHint(page);

    expect(hint).toBe('');
  });

  it('returns empty string when text has asterisks but not enough', async () => {
    const page = makePage('***12');

    const hint = await OTP_MODULE.extractPhoneHint(page);

    expect(hint).toBe('');
  });
});

// ── clickOtpTriggerIfPresent — iframe trigger ───────────────────────────────

describe('clickOtpTriggerIfPresent — trigger in iframe', () => {
  beforeEach(() => MOCK_TRY_IN_CONTEXT.mockResolvedValue(null));

  it('clicks trigger in child frame when main page has no trigger', async () => {
    const childFrame = makeMockFrame('https://bank.test/sms-frame');
    const page = makePage('', [childFrame]);
    MOCK_TRY_IN_CONTEXT.mockResolvedValueOnce(null).mockResolvedValueOnce('#sendSms');

    await OTP_MODULE.clickOtpTriggerIfPresent(page);

    expect(childFrame.click).toHaveBeenCalledWith('#sendSms');
  });

  it('uses cachedFrames when provided instead of page.frames()', async () => {
    const cachedChild = makeMockFrame('https://bank.test/cached');
    const page = makePage('');
    MOCK_TRY_IN_CONTEXT.mockResolvedValueOnce(null).mockResolvedValueOnce(
      'xpath=//button[contains(.,"שלח")]',
    );

    await OTP_MODULE.clickOtpTriggerIfPresent(page, [cachedChild]);

    expect(cachedChild.click).toHaveBeenCalledWith('xpath=//button[contains(.,"שלח")]');
  });

  it('prefers main page trigger over child frame trigger', async () => {
    const childFrame = makeMockFrame('https://bank.test/child');
    const page = makePage('', [childFrame]);
    MOCK_TRY_IN_CONTEXT.mockResolvedValueOnce('#sendSms');

    await OTP_MODULE.clickOtpTriggerIfPresent(page);

    expect(page.click).toHaveBeenCalledWith('#sendSms');
    expect(childFrame.click).not.toHaveBeenCalled();
  });

  it('returns true even when no trigger found', async () => {
    const page = makePage('');
    MOCK_TRY_IN_CONTEXT.mockResolvedValue(null);

    const isHandled = await OTP_MODULE.clickOtpTriggerIfPresent(page);

    expect(isHandled).toBe(true);
  });
});

// ── findOtpSubmitSelector — found in child frame ────────────────────────────

describe('findOtpSubmitSelector — frame fallback', () => {
  beforeEach(() => MOCK_TRY_IN_CONTEXT.mockResolvedValue(null));

  it('finds submit button in child frame when main page has none', async () => {
    const childFrame = makeMockFrame('https://bank.test/otp-frame');
    const page = makePage('', [childFrame]);
    MOCK_TRY_IN_CONTEXT.mockResolvedValueOnce(null).mockResolvedValueOnce('button[type="submit"]');

    const selector = await OTP_MODULE.findOtpSubmitSelector(page);

    expect(selector).toBe('button[type="submit"]');
  });

  it('returns empty string when no frame has submit button', async () => {
    const childFrame = makeMockFrame('https://bank.test/empty');
    const page = makePage('', [childFrame]);
    MOCK_TRY_IN_CONTEXT.mockResolvedValue('');

    const selector = await OTP_MODULE.findOtpSubmitSelector(page);

    expect(selector).toBe('');
  });
});
