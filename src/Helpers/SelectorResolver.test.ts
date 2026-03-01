import { type Frame, type Page } from 'playwright';
import {
  candidateToCss,
  extractCredentialKey,
  resolveFieldContext,
  tryInContext,
} from './SelectorResolver';
import { type FieldConfig, type SelectorCandidate } from '../Scrapers/LoginConfig';

jest.mock('./debug', () => ({ getDebug: () => jest.fn() }));

// ── Minimal Page/Frame mocks ─────────────────────────────────────────────────

type MockPageOverrides = Record<string, jest.Mock>;

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
    [{ kind: 'css', value: '#userCode' }, '#userCode'],
    [{ kind: 'placeholder', value: 'שם משתמש' }, 'input[placeholder*="שם משתמש"]'],
    [{ kind: 'ariaLabel', value: 'סיסמה' }, '[aria-label*="סיסמה"]'],
    [{ kind: 'name', value: 'password' }, '[name="password"]'],
    [
      { kind: 'xpath', value: '//button[contains(., "כניסה")]' },
      'xpath=//button[contains(., "כניסה")]',
    ],
  ])('converts %j → "%s"', (candidate, expected) => {
    expect(candidateToCss(candidate)).toBe(expected);
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
    ['#someOtherField', 'someOtherField'], // no canonical match → returns id portion
    ['input[placeholder="סיסמה"]', 'input[placeholder="סיסמה"]'], // non-id selector → full string
  ])('maps "%s" → "%s"', (selector, expected) => {
    expect(extractCredentialKey(selector)).toBe(expected);
  });
});

// ── tryInContext ──────────────────────────────────────────────────────────────

describe('tryInContext', () => {
  it('returns the CSS string when the first candidate resolves', async () => {
    const element = {};
    const ctx = makeFrame({ $: jest.fn().mockResolvedValue(element) });
    const candidates: SelectorCandidate[] = [{ kind: 'css', value: '#userCode' }];
    const result = await tryInContext(ctx, candidates);
    expect(result).toBe('#userCode');
  });

  it('returns null when no candidate resolves', async () => {
    const ctx = makeFrame({ $: jest.fn().mockResolvedValue(null) });
    const candidates: SelectorCandidate[] = [
      { kind: 'css', value: '#missing' },
      { kind: 'name', value: 'also-missing' },
    ];
    const result = await tryInContext(ctx, candidates);
    expect(result).toBeNull();
  });

  it('skips a candidate that throws (cross-origin frame) and continues', async () => {
    const element = {};
    const throwThenFind = jest
      .fn()
      .mockRejectedValueOnce(new Error('cross-origin'))
      .mockResolvedValueOnce(element);
    const ctx = makeFrame({ $: throwThenFind });
    const candidates: SelectorCandidate[] = [
      { kind: 'css', value: '#cross-origin' },
      { kind: 'css', value: '#found' },
    ];
    const result = await tryInContext(ctx, candidates);
    expect(result).toBe('#found');
  });
});

// ── resolveFieldContext ───────────────────────────────────────────────────────

describe('resolveFieldContext', () => {
  const field: FieldConfig = {
    credentialKey: 'username',
    selectors: [{ kind: 'css', value: '#userCode' }],
  };

  it('Round 1: returns immediately when configured CSS id found on page', async () => {
    const element = {};
    const page = makePage({ $: jest.fn().mockResolvedValue(element) });
    const result = await resolveFieldContext(page, field, 'https://bank.test/');
    expect(result.selector).toBe('#userCode');
    expect(result.context).toBe(page);
  });

  it('Round 3: falls back to WELL_KNOWN_SELECTORS when configured selector is absent', async () => {
    const findOnSecondCall = jest
      .fn()
      .mockResolvedValueOnce(null) // #userCode → not found
      .mockResolvedValue({}); // first WELL_KNOWN match → found
    const page = makePage({ $: findOnSecondCall });
    const result = await resolveFieldContext(page, field, 'https://bank.test/');
    // WELL_KNOWN_SELECTORS.username[0] = input[placeholder*="שם משתמש"]
    expect(result.selector).toBe('input[placeholder*="שם משתמש"]');
    expect(result.context).toBe(page);
  });

  it('Round 4: finds field inside an iframe when main page has no matching element', async () => {
    const iframeElement = {};
    const iframe = makeFrame({ $: jest.fn().mockResolvedValue(iframeElement) });
    const mainFrame = { url: jest.fn().mockReturnValue('https://bank.test/') };
    const page = makePage({
      $: jest.fn().mockResolvedValue(null), // all main-page searches fail
      frames: jest.fn().mockReturnValue([mainFrame, iframe]), // one child iframe
      mainFrame: jest.fn().mockReturnValue(mainFrame),
    });
    const result = await resolveFieldContext(page, field, 'https://bank.test/');
    expect(result.context).toBe(iframe);
  });

  it('throws a descriptive error listing all tried candidates when nothing resolves', async () => {
    const page = makePage({ $: jest.fn().mockResolvedValue(null) });
    await expect(resolveFieldContext(page, field, 'https://bank.test/')).rejects.toThrow(
      /Could not find 'username' field on https:\/\/bank\.test\//,
    );
  });

  it('error message includes tried candidate count and page title', async () => {
    const page = makePage({ $: jest.fn().mockResolvedValue(null) });
    await expect(resolveFieldContext(page, field, 'https://bank.test/')).rejects.toThrow(
      /Page title: "Bank Login"/,
    );
  });

  it('error message includes the inspect-bank-login hint', async () => {
    const page = makePage({ $: jest.fn().mockResolvedValue(null) });
    await expect(resolveFieldContext(page, field, 'https://bank.test/')).rejects.toThrow(
      /inspect-bank-login\.ts/,
    );
  });

  it('does not trigger Round 4 when called with a Frame (not a Page)', async () => {
    const frame = makeFrame({ $: jest.fn().mockResolvedValue(null) });
    await expect(resolveFieldContext(frame, field, 'https://bank.test/')).rejects.toThrow(
      /Could not find 'username'/,
    );
    // `frames` is not a method on Frame, so Round 4 is never attempted
  });
});
