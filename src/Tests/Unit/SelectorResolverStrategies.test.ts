import { jest } from '@jest/globals';
import type { Page } from 'playwright';

import type { IFieldConfig } from '../../Scrapers/Base/LoginConfig.js';

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

// ── resolveLabelText strategies ─────────────────────────────────────────────

describe('resolveLabelText strategies', () => {
  const labelField: IFieldConfig = { credentialKey: 'password', selectors: [] };

  /**
   * Creates a mock page with label-text resolution support.
   * @param querySelector - The mock querySelector function.
   * @returns A mock Page object.
   */
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
    const result = await SELECTOR_MOD.resolveFieldContext(page, labelField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.selector).toBe('#pw');
    expect(result.resolvedKind).toBe('labelText');
  });

  it('Strategy 2: <div>סיסמה<input></div> → resolves nested input', async () => {
    const divEl = {
      getAttribute: jest.fn().mockImplementation((attr: string) => {
        if (attr === 'for') return Promise.resolve(null);
        if (attr === 'id') return Promise.resolve(null);
        return Promise.resolve(null);
      }),
    };
    const querySelector = jest.fn().mockImplementation((sel: string) => {
      if (sel.includes('self::label') && sel.includes('סיסמה') && !sel.includes('//input'))
        return Promise.resolve(divEl);
      if (sel.includes('סיסמה') && sel.includes('//input')) return Promise.resolve({});
      return Promise.resolve(null);
    });
    const page = makeLabelPage(querySelector);
    (page.$eval as jest.Mock).mockResolvedValue('input');
    const result = await SELECTOR_MOD.resolveFieldContext(page, labelField, 'https://bank.test/');
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
    const result = await SELECTOR_MOD.resolveFieldContext(page, labelField, 'https://bank.test/');
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
      if (sel.includes('//input[1]') && !sel.includes('following-sibling') && !sel.includes('../'))
        return Promise.resolve(null);
      if (sel.includes('following-sibling::input')) return Promise.resolve({});
      return Promise.resolve(null);
    });
    const page = makeLabelPage(querySelector);
    (page.$eval as jest.Mock).mockResolvedValue('input');
    const result = await SELECTOR_MOD.resolveFieldContext(page, labelField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.resolvedKind).toBe('labelText');
  });

  it('returns null when no labeling element found', async () => {
    const mainFrame = { url: jest.fn().mockReturnValue('https://bank.test/login') };
    const page = {
      $: jest.fn().mockResolvedValue(null),
      frames: jest.fn().mockReturnValue([mainFrame]),
      mainFrame: jest.fn().mockReturnValue(mainFrame),
      title: jest.fn().mockResolvedValue('Bank Login'),
      url: jest.fn().mockReturnValue('https://bank.test/login'),
    } as unknown as Page;
    const result = await SELECTOR_MOD.resolveFieldContext(page, labelField, 'https://bank.test/');
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
      if (sel.includes('self::label') && sel.includes('סיסמה') && !sel.includes('//input'))
        return Promise.resolve(divEl);
      if (sel.includes('סיסמה') && sel.includes('//input')) return Promise.resolve({});
      if (sel.includes('following-sibling::input')) return Promise.resolve({});
      if (sel.includes('placeholder')) return Promise.resolve({});
      return Promise.resolve(null);
    });
    const page = makeLabelPage(querySelector);
    (page.$eval as jest.Mock).mockResolvedValue('hidden');
    const result = await SELECTOR_MOD.resolveFieldContext(page, labelField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.resolvedKind).toBe('placeholder');
  });
});

// ── div/span strict fallback ────────────────────────────────────────────────

describe('div/span strict text fallback', () => {
  const labelField: IFieldConfig = { credentialKey: 'password', selectors: [] };

  /**
   * Creates a mock page for div/span label fallback tests.
   * @param querySelector - The mock querySelector function.
   * @returns A mock Page object.
   */
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
      if (sel.includes('//label[contains')) return Promise.resolve(null);
      if (sel.includes('text()[contains')) return Promise.resolve(spanEl);
      if (sel.includes('//input')) return Promise.resolve({});
      return Promise.resolve(null);
    });
    const page = makeLabelPage(querySelector);
    (page.$eval as jest.Mock).mockResolvedValue('input');
    const result = await SELECTOR_MOD.resolveFieldContext(page, labelField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.resolvedKind).toBe('labelText');
  });

  it('does NOT match <div> containing "סיסמה" only in nested child text', async () => {
    const querySelector = jest.fn().mockImplementation((sel: string) => {
      if (sel.includes('//label[contains')) return Promise.resolve(null);
      if (sel.includes('text()[contains')) return Promise.resolve(null);
      if (sel.includes('placeholder')) return Promise.resolve({});
      return Promise.resolve(null);
    });
    const page = makeLabelPage(querySelector);
    const result = await SELECTOR_MOD.resolveFieldContext(page, labelField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.resolvedKind).toBe('placeholder');
  });
});

// ── isFillableInput validation ──────────────────────────────────────────────

describe('isFillableInput (via nested input strategy)', () => {
  const labelField: IFieldConfig = { credentialKey: 'password', selectors: [] };

  /**
   * Creates a mock page for fillable input validation tests.
   * @param querySelector - The mock querySelector function.
   * @param evalMock - The mock $eval function.
   * @returns A mock Page object.
   */
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

  /**
   * Creates a mock querySelector that finds a label element.
   * @returns A jest.Mock configured for label-based selector resolution.
   */
  function makeQuerySelectorWithLabel(): jest.Mock {
    const labelEl = {
      getAttribute: jest.fn().mockResolvedValue(null),
    };
    return jest.fn().mockImplementation((sel: string) => {
      if (sel.includes('//label[contains')) return Promise.resolve(labelEl);
      if (sel.includes('//input')) return Promise.resolve({});
      return Promise.resolve(null);
    });
  }

  /**
   * Adds placeholder fallback support to a querySelector mock.
   * @param querySelector - The mock to enhance with placeholder support.
   * @returns The enhanced mock with placeholder fallback.
   */
  function addPlaceholderFallback(querySelector: jest.Mock): jest.Mock {
    const originalImpl = querySelector.getMockImplementation() as (sel: string) => Promise<object>;
    querySelector.mockImplementation((sel: string) => {
      if (sel.includes('placeholder')) return Promise.resolve({});
      return originalImpl(sel);
    });
    return querySelector;
  }

  it('accepts <input type="text"> (fillable)', async () => {
    const evalMock = jest.fn().mockResolvedValueOnce('input').mockResolvedValueOnce('text');
    const labelQuery = makeQuerySelectorWithLabel();
    const page = makeLabelPage(labelQuery, evalMock);
    const result = await SELECTOR_MOD.resolveFieldContext(page, labelField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.resolvedKind).toBe('labelText');
  });

  it('accepts <textarea> (fillable)', async () => {
    const evalMock = jest.fn().mockResolvedValueOnce('textarea');
    const labelQuery = makeQuerySelectorWithLabel();
    const page = makeLabelPage(labelQuery, evalMock);
    const result = await SELECTOR_MOD.resolveFieldContext(page, labelField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.resolvedKind).toBe('labelText');
  });

  it('rejects <input type="submit"> (not fillable)', async () => {
    const evalMock = jest.fn().mockResolvedValueOnce('input').mockResolvedValueOnce('submit');
    const baseQuery = makeQuerySelectorWithLabel();
    const querySelector = addPlaceholderFallback(baseQuery);
    const page = makeLabelPage(querySelector, evalMock);
    const result = await SELECTOR_MOD.resolveFieldContext(page, labelField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.resolvedKind).toBe('placeholder');
  });

  it('rejects <input type="hidden"> (not fillable)', async () => {
    const evalMock = jest.fn().mockResolvedValueOnce('input').mockResolvedValueOnce('hidden');
    const baseQuery = makeQuerySelectorWithLabel();
    const querySelector = addPlaceholderFallback(baseQuery);
    const page = makeLabelPage(querySelector, evalMock);
    const result = await SELECTOR_MOD.resolveFieldContext(page, labelField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.resolvedKind).toBe('placeholder');
  });

  it('rejects <div> element (not input/textarea)', async () => {
    const evalMock = jest.fn().mockResolvedValueOnce('div');
    const baseQuery = makeQuerySelectorWithLabel();
    const querySelector = addPlaceholderFallback(baseQuery);
    const page = makeLabelPage(querySelector, evalMock);
    const result = await SELECTOR_MOD.resolveFieldContext(page, labelField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.resolvedKind).toBe('placeholder');
  });
});
