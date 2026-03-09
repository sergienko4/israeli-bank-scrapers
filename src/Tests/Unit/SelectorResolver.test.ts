import { jest } from '@jest/globals';
import type { Frame, Page } from 'playwright';

import type { IFieldConfig, SelectorCandidate } from '../../Scrapers/Base/LoginConfig.js';

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
}));

const SELECTOR_MOD = await import('../../Common/SelectorResolver.js');

type MockPageOverrides = Record<string, jest.Mock>;

/**
 * Creates a mock Playwright Page for selector tests.
 * @param overrides - Optional mock method overrides.
 * @returns A mock Page object.
 */
function makePage(overrides: MockPageOverrides = {}): Page {
  const mainFrame = { url: jest.fn().mockReturnValue('https://bank.test/login') };
  return {
    $: jest.fn().mockResolvedValue(null),
    frames: jest.fn().mockReturnValue([mainFrame]),
    mainFrame: jest.fn().mockReturnValue(mainFrame),
    title: jest.fn().mockResolvedValue('Bank Login'),
    url: jest.fn().mockReturnValue('https://bank.test/login'),
    ...overrides,
  } as unknown as Page;
}

/**
 * Creates a mock Playwright Frame for selector tests.
 * @param overrides - Optional mock method overrides.
 * @returns A mock Frame object.
 */
function makeFrame(overrides: MockPageOverrides = {}): Frame {
  return {
    $: jest.fn().mockResolvedValue(null),
    url: jest.fn().mockReturnValue('https://bank.test/frame'),
    ...overrides,
  } as unknown as Frame;
}

// ── candidateToCss ────────────────────────────────────────────────────────────

describe('candidateToCss', () => {
  it.each<[SelectorCandidate, string]>([
    [{ kind: 'labelText', value: 'סיסמה' }, 'xpath=//label[contains(., "סיסמה")]'],
    [{ kind: 'css', value: '#userCode' }, '#userCode'],
    [{ kind: 'placeholder', value: 'שם משתמש' }, 'input[placeholder*="שם משתמש"]'],
    [{ kind: 'ariaLabel', value: 'סיסמה' }, 'input[aria-label="סיסמה"]'],
    [{ kind: 'name', value: 'password' }, '[name="password"]'],
    [
      { kind: 'xpath', value: '//button[contains(., "כניסה")]' },
      'xpath=//button[contains(., "כניסה")]',
    ],
  ])('converts %j → "%s"', (candidate, expected) => {
    const css = SELECTOR_MOD.candidateToCss(candidate);
    expect(css).toBe(expected);
  });
});

// ── extractCredentialKey ──────────────────────────────────────────────────────

describe('extractCredentialKey', () => {
  it.each([
    ['#userCode', 'username'],
    ['#password', 'password'],
    ['#tzPassword', 'password'],
    ['#tzId', 'id'],
    ['#aidnum', 'num'],
    ['#someOtherField', 'someOtherField'],
    ['input[placeholder="סיסמה"]', 'input[placeholder="סיסמה"]'],
  ])('maps "%s" → "%s"', (selector, expected) => {
    const key = SELECTOR_MOD.extractCredentialKey(selector);
    expect(key).toBe(expected);
  });
});

// ── tryInContext ──────────────────────────────────────────────────────────────

describe('tryInContext', () => {
  it('returns the CSS string when the first candidate resolves', async () => {
    const element = {};
    const ctx = makeFrame({ $: jest.fn().mockResolvedValue(element) });
    const candidates: SelectorCandidate[] = [{ kind: 'css', value: '#userCode' }];
    const result = await SELECTOR_MOD.tryInContext(ctx, candidates);
    expect(result).toBe('#userCode');
  });

  it('returns empty string when no candidate resolves', async () => {
    const ctx = makeFrame({ $: jest.fn().mockResolvedValue(null) });
    const candidates: SelectorCandidate[] = [
      { kind: 'css', value: '#missing' },
      { kind: 'name', value: 'also-missing' },
    ];
    const result = await SELECTOR_MOD.tryInContext(ctx, candidates);
    expect(result).toBe('');
  });

  it('skips a candidate that throws (cross-origin frame) and continues', async () => {
    const element = {};
    const crossOriginError = new Error('cross-origin');
    const throwThenFind = jest
      .fn()
      .mockRejectedValueOnce(crossOriginError)
      .mockResolvedValueOnce(element);
    const ctx = makeFrame({ $: throwThenFind });
    const candidates: SelectorCandidate[] = [
      { kind: 'css', value: '#cross-origin' },
      { kind: 'css', value: '#found' },
    ];
    const result = await SELECTOR_MOD.tryInContext(ctx, candidates);
    expect(result).toBe('#found');
  });
});

// ── resolveFieldContext ───────────────────────────────────────────────────────

describe('resolveFieldContext', () => {
  const field: IFieldConfig = {
    credentialKey: 'username',
    selectors: [{ kind: 'css', value: '#userCode' }],
  };

  it('resolves bankConfig CSS id — isResolved:true, resolvedVia:bankConfig, round:mainPage', async () => {
    const element = {};
    const page = makePage({ $: jest.fn().mockResolvedValue(element) });
    const result = await SELECTOR_MOD.resolveFieldContext(page, field, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.selector).toBe('#userCode');
    expect(result.context).toBe(page);
    expect(result.resolvedVia).toBe('bankConfig');
    expect(result.round).toBe('mainPage');
  });

  it('falls back to wellKnown when configured selector absent — resolvedVia:wellKnown', async () => {
    const findOnSecondCall = jest.fn().mockResolvedValueOnce(null).mockResolvedValue({});
    const page = makePage({ $: findOnSecondCall });
    const result = await SELECTOR_MOD.resolveFieldContext(page, field, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.selector).toBe('input[placeholder*="שם משתמש"]');
    expect(result.resolvedVia).toBe('wellKnown');
    expect(result.round).toBe('mainPage');
  });

  it('empty bank selectors resolved via wellKnown — resolvedVia:wellKnown', async () => {
    const element = {};
    const page = makePage({ $: jest.fn().mockResolvedValue(element) });
    const emptyField: IFieldConfig = { credentialKey: 'username', selectors: [] };
    const result = await SELECTOR_MOD.resolveFieldContext(page, emptyField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.selector).toBe('input[placeholder*="שם משתמש"]');
    expect(result.resolvedVia).toBe('wellKnown');
  });

  it('Round 1: finds field inside an iframe before checking the main page', async () => {
    const iframeElement = {};
    const iframe = makeFrame({ $: jest.fn().mockResolvedValue(iframeElement) });
    const mainFrame = { url: jest.fn().mockReturnValue('https://bank.test/') };
    const mainPageQuery = jest.fn().mockResolvedValue(null);
    const page = makePage({
      $: mainPageQuery,
      frames: jest.fn().mockReturnValue([mainFrame, iframe]),
      mainFrame: jest.fn().mockReturnValue(mainFrame),
    });
    const result = await SELECTOR_MOD.resolveFieldContext(page, field, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.context).toBe(iframe);
    expect(result.round).toBe('iframe');
    expect(mainPageQuery).not.toHaveBeenCalled();
  });

  it('returns isResolved:false with message when nothing resolves', async () => {
    const page = makePage({ $: jest.fn().mockResolvedValue(null) });
    const result = await SELECTOR_MOD.resolveFieldContext(page, field, 'https://bank.test/');
    expect(result.isResolved).toBe(false);
    expect(result.resolvedVia).toBe('notResolved');
    expect(result.round).toBe('notResolved');
    expect(result.message).toMatch(/Could not find 'username' field on https:\/\/bank\.test\//);
    expect(result.message).toMatch(/Page title: "Bank Login"/);
    expect(result.message).toMatch(/inspect-bank-login\.ts/);
  });

  it('does not search iframes when called with a Frame directly (not a Page)', async () => {
    const frame = makeFrame({ $: jest.fn().mockResolvedValue(null) });
    const result = await SELECTOR_MOD.resolveFieldContext(frame, field, 'https://bank.test/');
    expect(result.isResolved).toBe(false);
    expect(result.resolvedVia).toBe('notResolved');
  });
});

// ── toFirstCss ────────────────────────────────────────────────────────────────

describe('toFirstCss', () => {
  it('returns the CSS of the first candidate', () => {
    const candidates = [
      { kind: 'css' as const, value: '.balance' },
      { kind: 'ariaLabel' as const, value: 'יתרה' },
    ];
    const css = SELECTOR_MOD.toFirstCss(candidates);
    expect(css).toBe('.balance');
  });

  it('returns empty string for an empty array', () => {
    const css = SELECTOR_MOD.toFirstCss([]);
    expect(css).toBe('');
  });

  it('converts non-css kinds via candidateToCss', () => {
    const css = SELECTOR_MOD.toFirstCss([{ kind: 'placeholder', value: 'שם' }]);
    expect(css).toBe('input[placeholder*="שם"]');
  });
});

// ── resolveDashboardField ─────────────────────────────────────────────────────

describe('resolveDashboardField', () => {
  it('resolves bank candidate on main page — resolvedVia:bankConfig, round:mainPage', async () => {
    const page = makePage({ $: jest.fn().mockResolvedValue({}) });
    const result = await SELECTOR_MOD.resolveDashboardField({
      pageOrFrame: page,
      fieldKey: 'accountNumber',
      bankCandidates: [{ kind: 'css', value: '#acc-num' }],
      pageUrl: 'https://bank.test/dashboard',
    });
    expect(result.isResolved).toBe(true);
    expect(result.selector).toBe('#acc-num');
    expect(result.resolvedVia).toBe('bankConfig');
    expect(result.round).toBe('mainPage');
  });

  it('falls back to wellKnownDashboardSelectors when bank candidates miss', async () => {
    const findOnSecondCall = jest.fn().mockResolvedValueOnce(null).mockResolvedValue({});
    const page = makePage({ $: findOnSecondCall });
    const result = await SELECTOR_MOD.resolveDashboardField({
      pageOrFrame: page,
      fieldKey: 'balance',
      bankCandidates: [{ kind: 'css', value: '#custom-balance' }],
      pageUrl: 'https://bank.test/dashboard',
    });
    expect(result.isResolved).toBe(true);
    expect(result.resolvedVia).toBe('wellKnown');
    expect(result.selector).toBe('.balance');
  });

  it('resolves in iframe (Round 1) before main page (Round 2)', async () => {
    const iframe = makeFrame({ $: jest.fn().mockResolvedValue({}) });
    const mainFrame = { url: jest.fn().mockReturnValue('https://bank.test/') };
    const mainPageQuery = jest.fn().mockResolvedValue(null);
    const page = makePage({
      $: mainPageQuery,
      frames: jest.fn().mockReturnValue([mainFrame, iframe]),
      mainFrame: jest.fn().mockReturnValue(mainFrame),
    });
    const result = await SELECTOR_MOD.resolveDashboardField({
      pageOrFrame: page,
      fieldKey: 'balance',
      bankCandidates: [{ kind: 'css', value: '.balance' }],
      pageUrl: 'https://bank.test/dashboard',
    });
    expect(result.isResolved).toBe(true);
    expect(result.context).toBe(iframe);
    expect(result.round).toBe('iframe');
    expect(mainPageQuery).not.toHaveBeenCalled();
  });

  it('returns isResolved:false when nothing resolves', async () => {
    const page = makePage({ $: jest.fn().mockResolvedValue(null) });
    const result = await SELECTOR_MOD.resolveDashboardField({
      pageOrFrame: page,
      fieldKey: 'unknownField',
      bankCandidates: [{ kind: 'css', value: '#no-such-element' }],
      pageUrl: 'https://bank.test/dashboard',
    });
    expect(result.isResolved).toBe(false);
    expect(result.resolvedVia).toBe('notResolved');
    expect(result.round).toBe('notResolved');
  });
});

// ── ariaLabel exact match ───────────────────────────────────────────────────

describe('ariaLabel exact match', () => {
  it('matches input[aria-label="סיסמה"] exactly', async () => {
    const element = {};
    const ctx = makeFrame({ $: jest.fn().mockResolvedValue(element) });
    const candidates: SelectorCandidate[] = [{ kind: 'ariaLabel', value: 'סיסמה' }];
    const result = await SELECTOR_MOD.tryInContext(ctx, candidates);
    expect(result).toBe('input[aria-label="סיסמה"]');
  });

  it('does NOT match substring — candidateToCss uses exact match', () => {
    const css = SELECTOR_MOD.candidateToCss({ kind: 'ariaLabel', value: 'סיסמה' });
    expect(css).toBe('input[aria-label="סיסמה"]');
    expect(css).not.toContain('*=');
  });
});
