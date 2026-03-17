/**
 * OtpDetector branch-coverage tests.
 * Covers: getBodyText returning non-string, detectByText 'unknown' path,
 * detectByInputField with cached frames, findOtpSubmitSelector frame
 * fallback with empty string results, clickOtpTriggerIfPresent tryFallback path,
 * clickFromCandidates with no text candidates.
 */
import { jest } from '@jest/globals';
import type { Frame, Page } from 'playwright-core';

import { mockToXpathLiteral } from '../MockModuleFactories.js';

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
   * @returns delegated mock result.
   */
  tryInContext: (...args: unknown[]): unknown => MOCK_TRY_IN_CONTEXT(...args),
  toXpathLiteral: mockToXpathLiteral,
  candidateToCss: jest.fn((candidate: { value: string }) => candidate.value),
  resolveFieldContext: jest.fn().mockResolvedValue(null),
  resolveFieldWithCache: jest.fn().mockResolvedValue(null),
  extractCredentialKey: jest.fn((selector: string) => selector),
  resolveDashboardField: jest.fn().mockResolvedValue(null),
}));

const OTP_MODULE = await import('../../Common/OtpDetector.js');

/** Mock frame interface for OTP tests. */
interface IMockFrame extends Frame {
  $: jest.Mock;
  url: jest.Mock;
  click: jest.Mock;
}

/**
 * Creates a mock Playwright Frame.
 * @param url - URL the frame reports.
 * @returns A mock frame object.
 */
function makeMockFrame(url = 'https://bank.test/child'): IMockFrame {
  return {
    $: jest.fn().mockResolvedValue(null),
    url: jest.fn().mockReturnValue(url),
    click: jest.fn().mockResolvedValue(undefined),
    evaluate: jest.fn().mockResolvedValue(''),
    locator: jest.fn().mockReturnValue({ all: jest.fn().mockResolvedValue([]) }),
  } as unknown as IMockFrame;
}

/** Mock page interface for OTP tests. */
interface IMockPage extends Page {
  evaluate: jest.Mock;
  frames: jest.Mock;
  mainFrame: jest.Mock;
  url: jest.Mock;
  click: jest.Mock;
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
    locator: jest.fn().mockReturnValue({ all: jest.fn().mockResolvedValue([]) }),
    frameLocator: jest.fn().mockReturnValue({
      locator: jest.fn().mockReturnValue({
        waitFor: jest.fn().mockRejectedValue(new Error('not found')),
        hover: jest.fn(),
        click: jest.fn(),
      }),
    }),
  } as unknown as IMockPage;
}

describe('detectOtpScreen — getBodyText returns non-string', () => {
  beforeEach(() => MOCK_TRY_IN_CONTEXT.mockResolvedValue(null));

  it('returns false when evaluate returns number', async () => {
    const page = makePage(undefined);
    page.evaluate.mockResolvedValueOnce(42);
    expect(await OTP_MODULE.detectOtpScreen(page)).toBe(false);
    expect(MOCK_TRY_IN_CONTEXT).not.toHaveBeenCalled();
  });

  it('returns false when evaluate returns null', async () => {
    const page = makePage(undefined);
    page.evaluate.mockResolvedValueOnce(null);
    expect(await OTP_MODULE.detectOtpScreen(page)).toBe(false);
  });
});

describe('detectOtpScreen — detectByInputField with cachedFrames', () => {
  beforeEach(() => MOCK_TRY_IN_CONTEXT.mockResolvedValue(null));

  it('checks multiple child frames when input not in main', async () => {
    const child1 = makeMockFrame('https://bank.test/f1');
    const child2 = makeMockFrame('https://bank.test/f2');
    const page = makePage('Welcome to banking', [child1, child2]);
    MOCK_TRY_IN_CONTEXT.mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('[name="otp"]');
    expect(await OTP_MODULE.detectOtpScreen(page)).toBe(true);
  });
});

describe('findOtpSubmitSelector — all frames return empty string', () => {
  beforeEach(() => MOCK_TRY_IN_CONTEXT.mockResolvedValue(''));

  it('returns empty string when all tryInContext calls return empty', async () => {
    const child = makeMockFrame('https://bank.test/frame1');
    const page = makePage('', [child]);
    const selector = await OTP_MODULE.findOtpSubmitSelector(page);
    expect(selector).toBe('');
  });
});

describe('clickOtpTriggerIfPresent — fallback click path', () => {
  beforeEach(() => MOCK_TRY_IN_CONTEXT.mockResolvedValue(null));

  it('returns false when click on fallback selector throws', async () => {
    const page = makePage('');
    MOCK_TRY_IN_CONTEXT.mockResolvedValueOnce('#failBtn');
    page.click.mockRejectedValueOnce(new Error('click failed'));
    const didClick = await OTP_MODULE.clickOtpTriggerIfPresent(page);
    expect(didClick).toBe(false);
  });
});

describe('clickFromCandidates — non-text candidates only', () => {
  beforeEach(() => MOCK_TRY_IN_CONTEXT.mockResolvedValue(null));

  it('goes straight to fallback when only css candidates', async () => {
    const page = makePage('');
    MOCK_TRY_IN_CONTEXT.mockResolvedValueOnce('#cssBtn');
    const candidates = [{ kind: 'css' as const, value: '#cssBtn' }];
    const didClick = await OTP_MODULE.clickFromCandidates(page, candidates);
    expect(page.click).toHaveBeenCalledWith('#cssBtn', { timeout: 5000 });
    expect(didClick).toBe(true);
  });

  it('returns false when fallback click rejects', async () => {
    const page = makePage('');
    MOCK_TRY_IN_CONTEXT.mockResolvedValueOnce('#failBtn');
    page.click.mockRejectedValueOnce(new Error('timeout'));
    const candidates = [{ kind: 'css' as const, value: '#failBtn' }];
    const didClick = await OTP_MODULE.clickFromCandidates(page, candidates);
    expect(didClick).toBe(false);
  });
});

describe('extractPhoneHint — body with no match', () => {
  it('returns empty for body with only text', async () => {
    const page = makePage('Enter the code sent to your phone');
    const hint = await OTP_MODULE.extractPhoneHint(page);
    expect(hint).toBe('');
  });
});
