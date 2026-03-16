import { jest } from '@jest/globals';
import type { Frame, Page } from 'playwright-core';

const MOCK_TRY_IN_CONTEXT = jest.fn();

jest.unstable_mockModule('../../Common/Debug.js', () => ({
  /**
   * Creates a mock debug logger.
   * @returns mock debug logger with all methods stubbed.
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
   * @param args - arguments forwarded to the mock.
   * @returns delegated mock result from MOCK_TRY_IN_CONTEXT.
   */
  tryInContext: (...args: unknown[]): unknown => MOCK_TRY_IN_CONTEXT(...args),
  candidateToCss: jest.fn((candidate: { value: string }) => candidate.value),
  resolveFieldContext: jest.fn().mockResolvedValue(null),
  resolveFieldWithCache: jest.fn().mockResolvedValue(null),
  extractCredentialKey: jest.fn((selector: string) => selector),
  resolveDashboardField: jest.fn().mockResolvedValue(null),
}));

const OTP_MODULE = await import('../../Common/OtpDetector.js');

interface IOtpMockPage {
  evaluate: jest.Mock;
  frames: jest.Mock;
  mainFrame: jest.Mock;
  url: jest.Mock;
  click: jest.Mock;
  frameLocator: jest.Mock;
}

/**
 * Creates a mock page with a given body text for OTP tests.
 * @param bodyText - text returned by page.evaluate for body content detection.
 * @returns mock page object cast as IOtpMockPage and Page.
 */
function makePage(bodyText?: string): IOtpMockPage & Page {
  const mainFrame = {
    $: jest.fn().mockResolvedValue(null),
    url: jest.fn().mockReturnValue('https://bank.test'),
  } as unknown as Frame;
  return {
    evaluate: jest.fn().mockResolvedValue(bodyText),
    frames: jest.fn().mockReturnValue([mainFrame]),
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
  } as unknown as IOtpMockPage & Page;
}

/**
 * Creates a mock page with a child iframe for OTP iframe tests.
 * @param bodyText - text returned by page.evaluate for body content detection.
 * @returns mock page object cast as IOtpMockPage and Page.
 */
function makePageWithIframe(bodyText: string): IOtpMockPage & Page {
  const mainFrame = {
    $: jest.fn().mockResolvedValue(null),
    url: jest.fn().mockReturnValue('https://bank.test'),
  } as unknown as Frame;
  const childFrame = {
    $: jest.fn().mockResolvedValue(null),
    url: jest.fn().mockReturnValue('https://bank.test/frame'),
  } as unknown as Frame;
  return {
    evaluate: jest.fn().mockResolvedValue(bodyText),
    frames: jest.fn().mockReturnValue([mainFrame, childFrame]),
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
  } as unknown as IOtpMockPage & Page;
}

// ── detectOtpScreen ───────────────────────────────────────────────────────────

describe('detectOtpScreen', () => {
  beforeEach(() => {
    MOCK_TRY_IN_CONTEXT.mockResolvedValue(null);
  });

  it('returns true when body text contains "סיסמה חד פעמית"', async () => {
    const page = makePage('סיסמה חד פעמית - יש להזין קוד');
    expect(await OTP_MODULE.detectOtpScreen(page)).toBe(true);
    expect(page.evaluate).toHaveBeenCalled();
    expect(MOCK_TRY_IN_CONTEXT).not.toHaveBeenCalled(); // text check short-circuits
  });

  it('returns true when body text contains exact Beinleumi OTP phrase', async () => {
    const page = makePage('לצורך אימות זהותך, יש לבחור טלפון לקבלת סיסמה חד פעמית');
    expect(await OTP_MODULE.detectOtpScreen(page)).toBe(true);
  });

  it('returns true when OTP input field present (text check fails, input found in page)', async () => {
    const page = makePage('ברוכים הבאים. אנא הכנס שם משתמש');
    MOCK_TRY_IN_CONTEXT.mockResolvedValueOnce('input[placeholder*="קוד חד פעמי"]');
    expect(await OTP_MODULE.detectOtpScreen(page)).toBe(true);
    expect(MOCK_TRY_IN_CONTEXT).toHaveBeenCalled();
  });

  it('returns true when OTP input is in a child iframe (Round 4)', async () => {
    const page = makePageWithIframe('ברוכים הבאים');
    MOCK_TRY_IN_CONTEXT.mockResolvedValueOnce(null).mockResolvedValueOnce(
      'input[placeholder*="קוד אימות"]',
    );
    expect(await OTP_MODULE.detectOtpScreen(page)).toBe(true);
  });

  it('returns false on login error page with no OTP keywords', async () => {
    const page = makePage('שם משתמש שגוי. ניסיון 2 מתוך 3');
    MOCK_TRY_IN_CONTEXT.mockResolvedValue(null);
    expect(await OTP_MODULE.detectOtpScreen(page)).toBe(false);
  });

  it('returns false on normal login page', async () => {
    const page = makePage('ברוכים הבאים. אנא הכנס שם משתמש וסיסמה');
    MOCK_TRY_IN_CONTEXT.mockResolvedValue(null);
    expect(await OTP_MODULE.detectOtpScreen(page)).toBe(false);
  });

  it('returns false and skips input check when page context is inaccessible (evaluate returns non-string)', async () => {
    const page = makePage(undefined);
    expect(await OTP_MODULE.detectOtpScreen(page)).toBe(false);
    expect(MOCK_TRY_IN_CONTEXT).not.toHaveBeenCalled();
  });
});

// ── extractPhoneHint ──────────────────────────────────────────────────────────

describe('extractPhoneHint', () => {
  it('returns masked phone like "******5100" from page text', async () => {
    const page = makePage('יש לבחור טלפון: ******5100 לקבלת SMS');
    expect(await OTP_MODULE.extractPhoneHint(page)).toBe('******5100');
  });

  it('returns masked phone with fewer asterisks', async () => {
    const page = makePage('קבל קוד ל-****0099');
    expect(await OTP_MODULE.extractPhoneHint(page)).toBe('****0099');
  });

  it('returns empty string when no phone pattern found', async () => {
    const page = makePage('הזן קוד SMS שנשלח אליך');
    expect(await OTP_MODULE.extractPhoneHint(page)).toBe('');
  });

  it('returns empty string when page context is inaccessible', async () => {
    const page = makePage(undefined);
    expect(await OTP_MODULE.extractPhoneHint(page)).toBe('');
  });
});

// ── findOtpSubmitSelector ─────────────────────────────────────────────────────

describe('findOtpSubmitSelector', () => {
  beforeEach(() => {
    MOCK_TRY_IN_CONTEXT.mockResolvedValue(null);
  });

  it('finds "אשר" button', async () => {
    const page = makePage('');
    MOCK_TRY_IN_CONTEXT.mockResolvedValueOnce('xpath=//button[contains(.,"אשר")]');
    expect(await OTP_MODULE.findOtpSubmitSelector(page)).toBe('xpath=//button[contains(.,"אשר")]');
  });

  it('finds "המשך" button when "אשר" is absent', async () => {
    const page = makePage('');
    MOCK_TRY_IN_CONTEXT.mockResolvedValueOnce('xpath=//button[contains(.,"המשך")]');
    expect(await OTP_MODULE.findOtpSubmitSelector(page)).toBe('xpath=//button[contains(.,"המשך")]');
  });

  it('finds [aria-label*="כניסה"] — Beinleumi input[type="button"] aria-label submit', async () => {
    // tryInContext is mocked as a unit — returns one value for the entire candidates list
    const page = makePage('');
    MOCK_TRY_IN_CONTEXT.mockResolvedValueOnce('[aria-label*="כניסה"]');
    expect(await OTP_MODULE.findOtpSubmitSelector(page)).toBe('[aria-label*="כניסה"]');
  });

  it('finds input[type="button"] as last-resort fallback for Beinleumi-style banks', async () => {
    const page = makePage('');
    MOCK_TRY_IN_CONTEXT.mockResolvedValueOnce('input[type="button"]');
    expect(await OTP_MODULE.findOtpSubmitSelector(page)).toBe('input[type="button"]');
  });

  it('falls back to button[type="submit"]', async () => {
    const page = makePage('');
    MOCK_TRY_IN_CONTEXT.mockResolvedValueOnce('button[type="submit"]');
    expect(await OTP_MODULE.findOtpSubmitSelector(page)).toBe('button[type="submit"]');
  });

  it('returns empty string when no submit button found', async () => {
    const page = makePage('');
    MOCK_TRY_IN_CONTEXT.mockResolvedValue(null);
    expect(await OTP_MODULE.findOtpSubmitSelector(page)).toBe('');
  });
});

// ── clickOtpTriggerIfPresent ──────────────────────────────────────────────────

describe('clickOtpTriggerIfPresent', () => {
  beforeEach(() => {
    MOCK_TRY_IN_CONTEXT.mockResolvedValue(null);
  });

  it('clicks "שלח" button when found — Beinleumi sendSms pattern', async () => {
    const page = makePage('לצורך אימות זהותך');
    MOCK_TRY_IN_CONTEXT.mockResolvedValueOnce('xpath=//button[contains(.,"שלח")]');
    await OTP_MODULE.clickOtpTriggerIfPresent(page);
    expect(page.click).toHaveBeenCalledWith('xpath=//button[contains(.,"שלח")]');
  });

  it('clicks the first matching trigger candidate', async () => {
    const page = makePage('');
    MOCK_TRY_IN_CONTEXT.mockResolvedValueOnce('xpath=//button[contains(.,"SMS")]');
    await OTP_MODULE.clickOtpTriggerIfPresent(page);
    expect(page.click).toHaveBeenCalledWith('xpath=//button[contains(.,"SMS")]');
  });

  it('is a no-op when no trigger button found (auto-sent SMS or already on entry screen)', async () => {
    const page = makePage('');
    MOCK_TRY_IN_CONTEXT.mockResolvedValue(null);
    await OTP_MODULE.clickOtpTriggerIfPresent(page);
    expect(page.click).not.toHaveBeenCalled();
  });
});
