import { type Frame, type Page } from 'playwright';
import {
  detectOtpScreen,
  extractPhoneHint,
  findOtpSubmitSelector,
  clickOtpTriggerIfPresent,
} from './OtpDetector';

jest.mock('./Debug', () => ({ getDebug: () => jest.fn() }));

const mockTryInContext = jest.fn();
jest.mock('./SelectorResolver', () => ({
  tryInContext: (...args: unknown[]): unknown => mockTryInContext(...args),
  candidateToCss: jest.fn((c: { value: string }) => c.value),
}));

type OtpMockPage = {
  evaluate: jest.Mock;
  frames: jest.Mock;
  mainFrame: jest.Mock;
  url: jest.Mock;
  click: jest.Mock;
  frameLocator: jest.Mock;
};

function makePage(bodyText: string | undefined): OtpMockPage & Page {
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
  } as unknown as OtpMockPage & Page;
}

function makePageWithIframe(bodyText: string): OtpMockPage & Page {
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
  } as unknown as OtpMockPage & Page;
}

// ── detectOtpScreen ───────────────────────────────────────────────────────────

describe('detectOtpScreen', () => {
  beforeEach(() => {
    mockTryInContext.mockResolvedValue(null);
  });

  it('returns true when body text contains "סיסמה חד פעמית"', async () => {
    const page = makePage('סיסמה חד פעמית - יש להזין קוד');
    expect(await detectOtpScreen(page)).toBe(true);
    expect(page.evaluate).toHaveBeenCalled();
    expect(mockTryInContext).not.toHaveBeenCalled(); // text check short-circuits
  });

  it('returns true when body text contains exact Beinleumi OTP phrase', async () => {
    const page = makePage('לצורך אימות זהותך, יש לבחור טלפון לקבלת סיסמה חד פעמית');
    expect(await detectOtpScreen(page)).toBe(true);
  });

  it('returns true when OTP input field present (text check fails, input found in page)', async () => {
    const page = makePage('ברוכים הבאים. אנא הכנס שם משתמש');
    mockTryInContext.mockResolvedValueOnce('input[placeholder*="קוד חד פעמי"]');
    expect(await detectOtpScreen(page)).toBe(true);
    expect(mockTryInContext).toHaveBeenCalled();
  });

  it('returns true when OTP input is in a child iframe (Round 4)', async () => {
    const page = makePageWithIframe('ברוכים הבאים');
    mockTryInContext
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('input[placeholder*="קוד אימות"]');
    expect(await detectOtpScreen(page)).toBe(true);
  });

  it('returns false on login error page with no OTP keywords', async () => {
    const page = makePage('שם משתמש שגוי. ניסיון 2 מתוך 3');
    mockTryInContext.mockResolvedValue(null);
    expect(await detectOtpScreen(page)).toBe(false);
  });

  it('returns false on normal login page', async () => {
    const page = makePage('ברוכים הבאים. אנא הכנס שם משתמש וסיסמה');
    mockTryInContext.mockResolvedValue(null);
    expect(await detectOtpScreen(page)).toBe(false);
  });

  it('returns false and skips input check when page context is inaccessible (evaluate returns non-string)', async () => {
    const page = makePage(undefined);
    expect(await detectOtpScreen(page)).toBe(false);
    expect(mockTryInContext).not.toHaveBeenCalled();
  });
});

// ── extractPhoneHint ──────────────────────────────────────────────────────────

describe('extractPhoneHint', () => {
  it('returns masked phone like "******5100" from page text', async () => {
    const page = makePage('יש לבחור טלפון: ******5100 לקבלת SMS');
    expect(await extractPhoneHint(page)).toBe('******5100');
  });

  it('returns masked phone with fewer asterisks', async () => {
    const page = makePage('קבל קוד ל-****0099');
    expect(await extractPhoneHint(page)).toBe('****0099');
  });

  it('returns empty string when no phone pattern found', async () => {
    const page = makePage('הזן קוד SMS שנשלח אליך');
    expect(await extractPhoneHint(page)).toBe('');
  });

  it('returns empty string when page context is inaccessible', async () => {
    const page = makePage(undefined);
    expect(await extractPhoneHint(page)).toBe('');
  });
});

// ── findOtpSubmitSelector ─────────────────────────────────────────────────────

describe('findOtpSubmitSelector', () => {
  beforeEach(() => {
    mockTryInContext.mockResolvedValue(null);
  });

  it('finds "אשר" button', async () => {
    const page = makePage('');
    mockTryInContext.mockResolvedValueOnce('xpath=//button[contains(.,"אשר")]');
    expect(await findOtpSubmitSelector(page)).toBe('xpath=//button[contains(.,"אשר")]');
  });

  it('finds "המשך" button when "אשר" is absent', async () => {
    const page = makePage('');
    mockTryInContext.mockResolvedValueOnce('xpath=//button[contains(.,"המשך")]');
    expect(await findOtpSubmitSelector(page)).toBe('xpath=//button[contains(.,"המשך")]');
  });

  it('finds [aria-label*="כניסה"] — Beinleumi input[type="button"] aria-label submit', async () => {
    // tryInContext is mocked as a unit — returns one value for the entire candidates list
    const page = makePage('');
    mockTryInContext.mockResolvedValueOnce('[aria-label*="כניסה"]');
    expect(await findOtpSubmitSelector(page)).toBe('[aria-label*="כניסה"]');
  });

  it('finds input[type="button"] as last-resort fallback for Beinleumi-style banks', async () => {
    const page = makePage('');
    mockTryInContext.mockResolvedValueOnce('input[type="button"]');
    expect(await findOtpSubmitSelector(page)).toBe('input[type="button"]');
  });

  it('falls back to button[type="submit"]', async () => {
    const page = makePage('');
    mockTryInContext.mockResolvedValueOnce('button[type="submit"]');
    expect(await findOtpSubmitSelector(page)).toBe('button[type="submit"]');
  });

  it('returns null when no submit button found', async () => {
    const page = makePage('');
    mockTryInContext.mockResolvedValue(null);
    expect(await findOtpSubmitSelector(page)).toBeNull();
  });
});

// ── clickOtpTriggerIfPresent ──────────────────────────────────────────────────

describe('clickOtpTriggerIfPresent', () => {
  beforeEach(() => {
    mockTryInContext.mockResolvedValue(null);
  });

  it('clicks "שלח" button when found — Beinleumi sendSms pattern', async () => {
    const page = makePage('לצורך אימות זהותך');
    mockTryInContext.mockResolvedValueOnce('xpath=//button[contains(.,"שלח")]');
    await clickOtpTriggerIfPresent(page);
    expect(page.click).toHaveBeenCalledWith('xpath=//button[contains(.,"שלח")]');
  });

  it('clicks the first matching trigger candidate', async () => {
    const page = makePage('');
    mockTryInContext.mockResolvedValueOnce('xpath=//button[contains(.,"SMS")]');
    await clickOtpTriggerIfPresent(page);
    expect(page.click).toHaveBeenCalledWith('xpath=//button[contains(.,"SMS")]');
  });

  it('is a no-op when no trigger button found (auto-sent SMS or already on entry screen)', async () => {
    const page = makePage('');
    mockTryInContext.mockResolvedValue(null);
    await clickOtpTriggerIfPresent(page);
    expect(page.click).not.toHaveBeenCalled();
  });
});
