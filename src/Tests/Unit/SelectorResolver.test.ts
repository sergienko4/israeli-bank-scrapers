import { jest } from '@jest/globals';
import type { Frame, Page } from 'playwright';

import type { FieldConfig, SelectorCandidate } from '../../Scrapers/Base/LoginConfig.js';

jest.unstable_mockModule('../../Common/Debug.js', () => ({
  getDebug: () => ({
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

const {
  candidateToCss,
  extractCredentialKey,
  resolveDashboardField,
  resolveFieldContext,
  toFirstCss,
  tryInContext,
} = await import('../../Common/SelectorResolver.js');

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
    // wellKnown.username[0-2] are labelText (fail on mock — no getAttribute), [3] is placeholder
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
    // wellKnown.username[0-2] are labelText (fail on mock), [3] is placeholder
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

// ── toFirstCss ────────────────────────────────────────────────────────────────

describe('toFirstCss', () => {
  it('returns the CSS of the first candidate', () => {
    const candidates = [
      { kind: 'css' as const, value: '.balance' },
      { kind: 'ariaLabel' as const, value: 'יתרה' },
    ];
    expect(toFirstCss(candidates)).toBe('.balance');
  });

  it('returns empty string for an empty array', () => {
    expect(toFirstCss([])).toBe('');
  });

  it('converts non-css kinds via candidateToCss', () => {
    expect(toFirstCss([{ kind: 'placeholder', value: 'שם' }])).toBe('input[placeholder*="שם"]');
  });
});

// ── resolveDashboardField ─────────────────────────────────────────────────────

describe('resolveDashboardField', () => {
  it('resolves bank candidate on main page — resolvedVia:bankConfig, round:mainPage', async () => {
    const page = makePage({ $: jest.fn().mockResolvedValue({}) });
    const result = await resolveDashboardField({
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
    // bank candidate not found → falls through to wellKnown 'balance' key
    const findOnSecondCall = jest
      .fn()
      .mockResolvedValueOnce(null) // bank candidate #custom-balance → not found
      .mockResolvedValue({}); // wellKnown .balance → found
    const page = makePage({ $: findOnSecondCall });
    const result = await resolveDashboardField({
      pageOrFrame: page,
      fieldKey: 'balance',
      bankCandidates: [{ kind: 'css', value: '#custom-balance' }],
      pageUrl: 'https://bank.test/dashboard',
    });
    expect(result.isResolved).toBe(true);
    expect(result.resolvedVia).toBe('wellKnown');
    expect(result.selector).toBe('.balance'); // first wellKnownDashboardSelectors.balance entry
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
    const result = await resolveDashboardField({
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
    const result = await resolveDashboardField({
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

// ── resolveLabelText strategies ─────────────────────────────────────────────

describe('resolveLabelText strategies', () => {
  const labelField: FieldConfig = { credentialKey: 'password', selectors: [] };

  function makeLabelPage(querySelector: jest.Mock): Page {
    const mainFrame = { url: jest.fn().mockReturnValue('https://bank.test/login') };
    return {
      $: querySelector,
      $eval: jest.fn(),
      frames: jest.fn().mockReturnValue([mainFrame]),
      mainFrame: jest.fn().mockReturnValue(mainFrame),
      title: jest.fn().mockResolvedValue('Login'),
      url: jest.fn().mockReturnValue('https://bank.test/login'),
    } as unknown as Page;
  }

  it('Strategy 1: <label for="pw"> → resolves #pw', async () => {
    const labelEl = { getAttribute: jest.fn().mockResolvedValue('pw') };
    const inputEl = {};
    const querySelector = jest.fn().mockImplementation((sel: string) => {
      if (sel.includes('label') && sel.includes('סיסמה')) return Promise.resolve(labelEl);
      if (sel === '#pw') return Promise.resolve(inputEl);
      return Promise.resolve(null);
    });
    const page = makeLabelPage(querySelector);
    const result = await resolveFieldContext(page, labelField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.selector).toBe('#pw');
    expect(result.resolvedKind).toBe('labelText');
  });

  it('Strategy 2: <div>סיסמה<input></div> → resolves nested input', async () => {
    const divEl = {
      getAttribute: jest.fn().mockImplementation((attr: string) => {
        if (attr === 'for') return Promise.resolve(null); // div has no for=
        if (attr === 'id') return Promise.resolve(null); // div has no id
        return Promise.resolve(null);
      }),
    };
    const querySelector = jest.fn().mockImplementation((sel: string) => {
      // labelText xpath finds a div
      if (sel.includes('self::label') && sel.includes('סיסמה') && !sel.includes('//input'))
        return Promise.resolve(divEl);
      // nested input xpath → found
      if (sel.includes('סיסמה') && sel.includes('//input')) return Promise.resolve({});
      return Promise.resolve(null);
    });
    const page = makeLabelPage(querySelector);
    (page.$eval as jest.Mock).mockResolvedValue('input'); // isFillableInput → tagName
    const result = await resolveFieldContext(page, labelField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.resolvedKind).toBe('labelText');
  });

  it('Strategy 3: <span id="lbl">סיסמה</span> + aria-labelledby → resolves input', async () => {
    const labelEl = {
      getAttribute: jest.fn().mockImplementation((attr: string) => {
        if (attr === 'for') return Promise.resolve(null);
        if (attr === 'id') return Promise.resolve('lbl');
        return Promise.resolve(null);
      }),
    };
    const querySelector = jest.fn().mockImplementation((sel: string) => {
      if (sel.includes('self::label') && sel.includes('סיסמה') && !sel.includes('//input'))
        return Promise.resolve(labelEl);
      if (sel === 'input[aria-labelledby="lbl"]') return Promise.resolve({});
      return Promise.resolve(null);
    });
    const page = makeLabelPage(querySelector);
    const result = await resolveFieldContext(page, labelField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.selector).toBe('input[aria-labelledby="lbl"]');
    expect(result.resolvedKind).toBe('labelText');
  });

  it('Strategy 4: <label>סיסמה</label><input> → resolves sibling input', async () => {
    const labelEl = {
      getAttribute: jest.fn().mockImplementation((attr: string) => {
        if (attr === 'for') return Promise.resolve(null);
        if (attr === 'id') return Promise.resolve(null);
        return Promise.resolve(null);
      }),
    };
    const querySelector = jest.fn().mockImplementation((sel: string) => {
      if (
        sel.includes('self::label') &&
        sel.includes('סיסמה') &&
        !sel.includes('//input') &&
        !sel.includes('following-sibling') &&
        !sel.includes('../')
      )
        return Promise.resolve(labelEl);
      // nested → not found
      if (sel.includes('//input[1]') && !sel.includes('following-sibling') && !sel.includes('../'))
        return Promise.resolve(null);
      // sibling → found
      if (sel.includes('following-sibling::input')) return Promise.resolve({});
      return Promise.resolve(null);
    });
    const page = makeLabelPage(querySelector);
    (page.$eval as jest.Mock).mockResolvedValue('input');
    const result = await resolveFieldContext(page, labelField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.resolvedKind).toBe('labelText');
  });

  it('returns null when no labeling element found', async () => {
    const page = makePage({ $: jest.fn().mockResolvedValue(null) });
    const result = await resolveFieldContext(page, labelField, 'https://bank.test/');
    // All labelText + placeholder + css + ariaLabel candidates fail → not resolved
    expect(result.isResolved).toBe(false);
  });

  it('skips hidden inputs in nested strategy', async () => {
    const divEl = {
      getAttribute: jest.fn().mockImplementation((attr: string) => {
        if (attr === 'for') return Promise.resolve(null);
        if (attr === 'id') return Promise.resolve(null);
        return Promise.resolve(null);
      }),
    };
    const querySelector = jest.fn().mockImplementation((sel: string) => {
      // labelText xpath → div with no for/id
      if (sel.includes('self::label') && sel.includes('סיסמה') && !sel.includes('//input'))
        return Promise.resolve(divEl);
      // nested/sibling/proximity input → all found but hidden
      if (sel.includes('סיסמה') && sel.includes('//input')) return Promise.resolve({});
      if (sel.includes('following-sibling::input')) return Promise.resolve({});
      // placeholder fallback → found (non-labelText resolution)
      if (sel.includes('placeholder')) return Promise.resolve({});
      return Promise.resolve(null);
    });
    const page = makeLabelPage(querySelector);
    // isFillableInput: all labelText-found inputs are hidden
    (page.$eval as jest.Mock).mockResolvedValue('hidden');
    const result = await resolveFieldContext(page, labelField, 'https://bank.test/');
    // all labelText inputs are hidden → falls through to placeholder
    expect(result.isResolved).toBe(true);
    expect(result.resolvedKind).toBe('placeholder');
  });
});

// ── ariaLabel exact match ───────────────────────────────────────────────────

describe('ariaLabel exact match', () => {
  it('matches input[aria-label="סיסמה"] exactly', async () => {
    const element = {};
    const ctx = makeFrame({ $: jest.fn().mockResolvedValue(element) });
    const candidates: SelectorCandidate[] = [{ kind: 'ariaLabel', value: 'סיסמה' }];
    const result = await tryInContext(ctx, candidates);
    expect(result).toBe('input[aria-label="סיסמה"]');
  });

  it('does NOT match substring — candidateToCss uses exact match', () => {
    const css = candidateToCss({ kind: 'ariaLabel', value: 'סיסמה' });
    // Exact match (=), not substring (*=)
    expect(css).toBe('input[aria-label="סיסמה"]');
    expect(css).not.toContain('*=');
  });
});

// ── resolvedKind tracking — every SelectorCandidate kind ────────────────────

describe('resolvedKind tracking', () => {
  it('resolvedKind = "css" for CSS selector match', async () => {
    const page = makePage({ $: jest.fn().mockResolvedValue({}) });
    const field: FieldConfig = {
      credentialKey: 'username',
      selectors: [{ kind: 'css', value: '#userCode' }],
    };
    const result = await resolveFieldContext(page, field, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.resolvedKind).toBe('css');
  });

  it('resolvedKind = "placeholder" for placeholder match', async () => {
    const page = makePage({ $: jest.fn().mockResolvedValue({}) });
    const field: FieldConfig = {
      credentialKey: 'username',
      selectors: [{ kind: 'placeholder', value: 'שם משתמש' }],
    };
    const result = await resolveFieldContext(page, field, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.selector).toBe('input[placeholder*="שם משתמש"]');
    expect(result.resolvedKind).toBe('placeholder');
  });

  it('resolvedKind = "ariaLabel" for exact aria-label match', async () => {
    const page = makePage({ $: jest.fn().mockResolvedValue({}) });
    const field: FieldConfig = {
      credentialKey: 'username',
      selectors: [{ kind: 'ariaLabel', value: 'שם משתמש' }],
    };
    const result = await resolveFieldContext(page, field, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.selector).toBe('input[aria-label="שם משתמש"]');
    expect(result.resolvedKind).toBe('ariaLabel');
  });

  it('resolvedKind = "name" for name attribute match', async () => {
    const page = makePage({ $: jest.fn().mockResolvedValue({}) });
    const field: FieldConfig = {
      credentialKey: 'username',
      selectors: [{ kind: 'name', value: 'username' }],
    };
    const result = await resolveFieldContext(page, field, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.selector).toBe('[name="username"]');
    expect(result.resolvedKind).toBe('name');
  });

  it('resolvedKind = "xpath" for XPath match', async () => {
    const page = makePage({ $: jest.fn().mockResolvedValue({}) });
    const field: FieldConfig = {
      credentialKey: 'username',
      selectors: [{ kind: 'xpath', value: '//input[@id="user"]' }],
    };
    const result = await resolveFieldContext(page, field, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.selector).toBe('xpath=//input[@id="user"]');
    expect(result.resolvedKind).toBe('xpath');
  });

  it('resolvedKind is undefined when not resolved', async () => {
    const page = makePage({ $: jest.fn().mockResolvedValue(null) });
    const field: FieldConfig = { credentialKey: 'unknown', selectors: [] };
    const result = await resolveFieldContext(page, field, 'https://bank.test/');
    expect(result.isResolved).toBe(false);
    expect(result.resolvedKind).toBeUndefined();
  });
});

// ── Placeholder-specific edge cases ─────────────────────────────────────────

describe('placeholder resolution', () => {
  it('resolves via placeholder when it is the only candidate', async () => {
    const page = makePage({ $: jest.fn().mockResolvedValue({}) });
    const field: FieldConfig = {
      credentialKey: 'password',
      selectors: [{ kind: 'placeholder', value: 'סיסמה' }],
    };
    const result = await resolveFieldContext(page, field, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.selector).toBe('input[placeholder*="סיסמה"]');
    expect(result.resolvedKind).toBe('placeholder');
    expect(result.resolvedVia).toBe('bankConfig');
  });

  it('placeholder fallback from wellKnown when bank selectors empty', async () => {
    // wellKnown.password[0-2] are labelText (fail), [3] is placeholder
    const findPlaceholder = jest.fn().mockImplementation((sel: string) => {
      if (sel.includes('placeholder')) return Promise.resolve({});
      return Promise.resolve(null);
    });
    const page = makePage({ $: findPlaceholder });
    const field: FieldConfig = { credentialKey: 'password', selectors: [] };
    const result = await resolveFieldContext(page, field, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.selector).toBe('input[placeholder*="סיסמה"]');
    expect(result.resolvedVia).toBe('wellKnown');
    expect(result.resolvedKind).toBe('placeholder');
  });

  it('placeholder NOT found → falls through to css candidates', async () => {
    const findCss = jest.fn().mockImplementation((sel: string) => {
      if (sel === 'input[type="password"]') return Promise.resolve({});
      return Promise.resolve(null);
    });
    const page = makePage({ $: findCss });
    const field: FieldConfig = { credentialKey: 'password', selectors: [] };
    const result = await resolveFieldContext(page, field, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    // wellKnown password: placeholder entries fail, then css input[type=password] hits
    expect(result.selector).toBe('input[type="password"]');
    expect(result.resolvedKind).toBe('css');
  });

  it('first placeholder candidate wins over second', async () => {
    const page = makePage({ $: jest.fn().mockResolvedValue({}) });
    const field: FieldConfig = {
      credentialKey: 'test',
      selectors: [
        { kind: 'placeholder', value: 'first' },
        { kind: 'placeholder', value: 'second' },
      ],
    };
    const result = await resolveFieldContext(page, field, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.selector).toBe('input[placeholder*="first"]');
  });
});

// ── div/span strict fallback ────────────────────────────────────────────────

describe('div/span strict text fallback', () => {
  const labelField: FieldConfig = { credentialKey: 'password', selectors: [] };

  function makeLabelPage(querySelector: jest.Mock): Page {
    const mainFrame = { url: jest.fn().mockReturnValue('https://bank.test/login') };
    return {
      $: querySelector,
      $eval: jest.fn(),
      frames: jest.fn().mockReturnValue([mainFrame]),
      mainFrame: jest.fn().mockReturnValue(mainFrame),
      title: jest.fn().mockResolvedValue('Login'),
      url: jest.fn().mockReturnValue('https://bank.test/login'),
    } as unknown as Page;
  }

  it('finds input via <span>סיסמה</span> when no <label> exists', async () => {
    const spanEl = {
      getAttribute: jest.fn().mockImplementation((attr: string) => {
        if (attr === 'for') return Promise.resolve(null);
        if (attr === 'id') return Promise.resolve(null);
        return Promise.resolve(null);
      }),
    };
    const querySelector = jest.fn().mockImplementation((sel: string) => {
      // <label> xpath → not found
      if (sel.includes('//label[contains')) return Promise.resolve(null);
      // strict div/span xpath with text() → found
      if (sel.includes('text()[contains')) return Promise.resolve(spanEl);
      // nested input → found
      if (sel.includes('//input')) return Promise.resolve({});
      return Promise.resolve(null);
    });
    const page = makeLabelPage(querySelector);
    (page.$eval as jest.Mock).mockResolvedValue('input');
    const result = await resolveFieldContext(page, labelField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.resolvedKind).toBe('labelText');
  });

  it('does NOT match <div> containing "סיסמה" only in nested child text', async () => {
    // This simulates <div><p>סיסמה חד פעמית</p></div> — the div's OWN text
    // does not contain "סיסמה", only a nested <p> does.
    // The strict xpath text()[contains(.,"סיסמה")] should NOT match this div.
    const querySelector = jest.fn().mockImplementation((sel: string) => {
      // <label> → not found
      if (sel.includes('//label[contains')) return Promise.resolve(null);
      // strict div/span xpath → NOT found (text() doesn't match nested-only text)
      if (sel.includes('text()[contains')) return Promise.resolve(null);
      // placeholder fallback → found
      if (sel.includes('placeholder')) return Promise.resolve({});
      return Promise.resolve(null);
    });
    const page = makeLabelPage(querySelector);
    const result = await resolveFieldContext(page, labelField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    // Resolved via placeholder, NOT labelText — div/span false positive prevented
    expect(result.resolvedKind).toBe('placeholder');
  });
});

// ── isFillableInput validation ──────────────────────────────────────────────

describe('isFillableInput (via nested input strategy)', () => {
  const labelField: FieldConfig = { credentialKey: 'password', selectors: [] };

  function makeLabelPage(querySelector: jest.Mock, evalMock: jest.Mock): Page {
    const mainFrame = { url: jest.fn().mockReturnValue('https://bank.test/login') };
    return {
      $: querySelector,
      $eval: evalMock,
      frames: jest.fn().mockReturnValue([mainFrame]),
      mainFrame: jest.fn().mockReturnValue(mainFrame),
      title: jest.fn().mockResolvedValue('Login'),
      url: jest.fn().mockReturnValue('https://bank.test/login'),
    } as unknown as Page;
  }

  function makeQuerySelectorWithLabel(): jest.Mock {
    const labelEl = {
      getAttribute: jest.fn().mockResolvedValue(null), // no for=
    };
    return jest.fn().mockImplementation((sel: string) => {
      if (sel.includes('//label[contains')) return Promise.resolve(labelEl);
      if (sel.includes('//input')) return Promise.resolve({});
      return Promise.resolve(null);
    });
  }

  it('accepts <input type="text"> (fillable)', async () => {
    const evalMock = jest
      .fn()
      .mockResolvedValueOnce('input') // tagName
      .mockResolvedValueOnce('text'); // type
    const page = makeLabelPage(makeQuerySelectorWithLabel(), evalMock);
    const result = await resolveFieldContext(page, labelField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.resolvedKind).toBe('labelText');
  });

  it('accepts <textarea> (fillable)', async () => {
    const evalMock = jest.fn().mockResolvedValueOnce('textarea');
    const page = makeLabelPage(makeQuerySelectorWithLabel(), evalMock);
    const result = await resolveFieldContext(page, labelField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.resolvedKind).toBe('labelText');
  });

  it('rejects <input type="submit"> (not fillable)', async () => {
    const evalMock = jest.fn().mockResolvedValueOnce('input').mockResolvedValueOnce('submit');
    const querySelector = makeQuerySelectorWithLabel();
    // Also return {} for placeholder fallback
    const original = querySelector.getMockImplementation()!;
    querySelector.mockImplementation((sel: string) => {
      if (sel.includes('placeholder')) return Promise.resolve({});
      return original(sel);
    });
    const page = makeLabelPage(querySelector, evalMock);
    const result = await resolveFieldContext(page, labelField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    // Nested input was type=submit → rejected → fell through to placeholder
    expect(result.resolvedKind).toBe('placeholder');
  });

  it('rejects <input type="hidden"> (not fillable)', async () => {
    const evalMock = jest.fn().mockResolvedValueOnce('input').mockResolvedValueOnce('hidden');
    const querySelector = makeQuerySelectorWithLabel();
    const original = querySelector.getMockImplementation()!;
    querySelector.mockImplementation((sel: string) => {
      if (sel.includes('placeholder')) return Promise.resolve({});
      return original(sel);
    });
    const page = makeLabelPage(querySelector, evalMock);
    const result = await resolveFieldContext(page, labelField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.resolvedKind).toBe('placeholder');
  });

  it('rejects <div> element (not input/textarea)', async () => {
    const evalMock = jest.fn().mockResolvedValueOnce('div');
    const querySelector = makeQuerySelectorWithLabel();
    const original = querySelector.getMockImplementation()!;
    querySelector.mockImplementation((sel: string) => {
      if (sel.includes('placeholder')) return Promise.resolve({});
      return original(sel);
    });
    const page = makeLabelPage(querySelector, evalMock);
    const result = await resolveFieldContext(page, labelField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.resolvedKind).toBe('placeholder');
  });
});
