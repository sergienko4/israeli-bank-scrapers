import { type Frame, type Page } from 'playwright';

import {
  candidateToCss,
  extractCredentialKey,
  resolveFieldContext,
  tryInContext,
} from '../../Common/SelectorResolver';
import { type FieldConfig, type SelectorCandidate } from '../../Scrapers/Base/LoginConfig';

jest.mock('../../Common/Debug', () => ({
  getDebug: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

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

  it('resolves bankConfig CSS id — isResolved:true, resolvedVia:bankConfig, round:mainPage', async () => {
    const element = {};
    const page = makePage({ $: jest.fn().mockResolvedValue(element) });
    const result = await resolveFieldContext(page, field, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.selector).toBe('#userCode');
    expect(result.context).toBe(page);
    expect(result.resolvedVia).toBe('bankConfig');
    expect(result.round).toBe('mainPage');
  });

  it('falls back to wellKnown when configured selector absent — resolvedVia:wellKnown', async () => {
    const findOnSecondCall = jest
      .fn()
      .mockResolvedValueOnce(null) // #userCode → not found
      .mockResolvedValue({}); // first WELL_KNOWN match → found
    const page = makePage({ $: findOnSecondCall });
    const result = await resolveFieldContext(page, field, 'https://bank.test/');
    // WELL_KNOWN_SELECTORS.username[0] = input[placeholder*="שם משתמש"]
    expect(result.isResolved).toBe(true);
    expect(result.selector).toBe('input[placeholder*="שם משתמש"]');
    expect(result.resolvedVia).toBe('wellKnown');
    expect(result.round).toBe('mainPage');
  });

  it('empty bank selectors resolved via wellKnown — resolvedVia:wellKnown', async () => {
    const element = {};
    const page = makePage({ $: jest.fn().mockResolvedValue(element) });
    const emptyField: FieldConfig = { credentialKey: 'username', selectors: [] };
    const result = await resolveFieldContext(page, emptyField, 'https://bank.test/');
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
      frames: jest.fn().mockReturnValue([mainFrame, iframe]), // one child iframe
      mainFrame: jest.fn().mockReturnValue(mainFrame),
    });
    const result = await resolveFieldContext(page, field, 'https://bank.test/');
    // Iframe is found in Round 1 — main page query is never called
    expect(result.isResolved).toBe(true);
    expect(result.context).toBe(iframe);
    expect(result.round).toBe('iframe');
    expect(mainPageQuery).not.toHaveBeenCalled();
  });

  it('returns isResolved:false with message when nothing resolves', async () => {
    const page = makePage({ $: jest.fn().mockResolvedValue(null) });
    const result = await resolveFieldContext(page, field, 'https://bank.test/');
    expect(result.isResolved).toBe(false);
    expect(result.resolvedVia).toBe('notResolved');
    expect(result.round).toBe('notResolved');
    expect(result.message).toMatch(/Could not find 'username' field on https:\/\/bank\.test\//);
    expect(result.message).toMatch(/Page title: "Bank Login"/);
    expect(result.message).toMatch(/inspect-bank-login\.ts/);
  });

  it('does not search iframes when called with a Frame directly (not a Page)', async () => {
    const frame = makeFrame({ $: jest.fn().mockResolvedValue(null) });
    const result = await resolveFieldContext(frame, field, 'https://bank.test/');
    // Iframe search (Round 1) is skipped — `frames` is not a method on Frame
    expect(result.isResolved).toBe(false);
    expect(result.resolvedVia).toBe('notResolved');
  });
});
