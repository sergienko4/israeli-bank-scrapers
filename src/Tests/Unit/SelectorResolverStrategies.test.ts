import { jest } from '@jest/globals';
import type { Page } from 'playwright-core';

import type { IFieldConfig } from '../../Scrapers/Base/Config/LoginConfig.js';

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

const SELECTOR_MOD = await import('../../Common/SelectorResolver.js');

// ── resolveLabelText strategies ─────────────────────────────────────────────

describe('resolveLabelText strategies', () => {
  const labelField: IFieldConfig = { credentialKey: 'password', selectors: [] };

  /**
   * Creates a mock page with label-text resolution support.
   * @param querySelector - The mock querySelector function.
   * @param locMock - Optional locator mock for locator-based APIs.
   * @returns A mock Page object.
   */
  function makeLabelPage(querySelector: jest.Mock, locMock?: jest.Mock): Page {
    const mainFrame = { url: jest.fn().mockReturnValue('https://bank.test/login') };
    return {
      $: querySelector,
      locator:
        locMock ??
        jest.fn().mockReturnValue({
          first: jest.fn().mockReturnValue({
            count: jest.fn().mockResolvedValue(0),
            getAttribute: jest.fn().mockResolvedValue(null),
            evaluate: jest.fn().mockResolvedValue('input'),
          }),
          count: jest.fn().mockResolvedValue(0),
        }),
      frames: jest.fn().mockReturnValue([mainFrame]),
      mainFrame: jest.fn().mockReturnValue(mainFrame),
      title: jest.fn().mockResolvedValue('Login'),
      url: jest.fn().mockReturnValue('https://bank.test/login'),
    } as unknown as Page;
  }

  it('Strategy 1: <label for="pw"> → resolves #pw', async () => {
    const querySelector = jest.fn().mockImplementation((sel: string) => {
      if (sel.includes('label') && sel.includes('סיסמה')) return Promise.resolve({});
      if (sel === '#pw') return Promise.resolve({});
      return Promise.resolve(null);
    });
    const locMock = jest.fn().mockImplementation((sel: string) => {
      if (sel.includes('label') && sel.includes('סיסמה')) {
        const loc = {
          count: jest.fn().mockResolvedValue(1),
          getAttribute: jest.fn().mockResolvedValue('pw'),
          evaluate: jest.fn().mockResolvedValue('label'),
        };
        return { first: jest.fn().mockReturnValue(loc), count: jest.fn().mockResolvedValue(1) };
      }
      if (sel === '#pw') {
        const loc = {
          count: jest.fn().mockResolvedValue(1),
          evaluate: jest.fn().mockResolvedValue('input'),
          getAttribute: jest.fn().mockResolvedValue('password'),
        };
        return { first: jest.fn().mockReturnValue(loc), count: jest.fn().mockResolvedValue(1) };
      }
      const loc = { count: jest.fn().mockResolvedValue(0) };
      return { first: jest.fn().mockReturnValue(loc), count: jest.fn().mockResolvedValue(0) };
    });
    const page = makeLabelPage(querySelector, locMock);
    const result = await SELECTOR_MOD.resolveFieldContext(page, labelField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.selector).toBe('#pw');
    expect(result.resolvedKind).toBe('labelText');
  });

  it('Strategy 2: <div>סיסמה<input></div> → resolves nested input', async () => {
    const querySelector = jest.fn().mockImplementation((sel: string) => {
      if (sel.includes('self::label') && sel.includes('סיסמה') && !sel.includes('//input'))
        return Promise.resolve({});
      if (sel.includes('סיסמה') && sel.includes('//input')) return Promise.resolve({});
      return Promise.resolve(null);
    });
    const locMock = jest.fn().mockImplementation((sel: string) => {
      if (sel.includes('self::label') && sel.includes('סיסמה') && !sel.includes('//input')) {
        const loc = {
          count: jest.fn().mockResolvedValue(1),
          getAttribute: jest.fn().mockResolvedValue(null),
        };
        return { first: jest.fn().mockReturnValue(loc), count: jest.fn().mockResolvedValue(1) };
      }
      const inputLoc = {
        count: jest.fn().mockResolvedValue(1),
        evaluate: jest.fn().mockResolvedValue('input'),
        getAttribute: jest.fn().mockResolvedValue('text'),
      };
      return { first: jest.fn().mockReturnValue(inputLoc), count: jest.fn().mockResolvedValue(1) };
    });
    const page = makeLabelPage(querySelector, locMock);
    const result = await SELECTOR_MOD.resolveFieldContext(page, labelField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.resolvedKind).toBe('labelText');
  });

  it('Strategy 3: <span id="lbl">סיסמה</span> + aria-labelledby → resolves input', async () => {
    const querySelector = jest.fn().mockImplementation((sel: string) => {
      if (sel.includes('self::label') && sel.includes('סיסמה') && !sel.includes('//input'))
        return Promise.resolve({});
      if (sel === 'input[aria-labelledby="lbl"]') return Promise.resolve({});
      return Promise.resolve(null);
    });
    const locMock = jest.fn().mockImplementation((sel: string) => {
      if (sel.includes('self::label') && sel.includes('סיסמה')) {
        const loc = {
          count: jest.fn().mockResolvedValue(1),
          getAttribute: jest.fn().mockImplementation((attr: string) => {
            if (attr === 'for') return Promise.resolve(null);
            if (attr === 'id') return Promise.resolve('lbl');
            return Promise.resolve(null);
          }),
        };
        return { first: jest.fn().mockReturnValue(loc), count: jest.fn().mockResolvedValue(1) };
      }
      const loc = { count: jest.fn().mockResolvedValue(0) };
      return { first: jest.fn().mockReturnValue(loc), count: jest.fn().mockResolvedValue(0) };
    });
    const page = makeLabelPage(querySelector, locMock);
    const result = await SELECTOR_MOD.resolveFieldContext(page, labelField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.selector).toBe('input[aria-labelledby="lbl"]');
    expect(result.resolvedKind).toBe('labelText');
  });

  it('Strategy 4: <label>סיסמה</label><input> → resolves sibling input', async () => {
    const querySelector = jest.fn().mockImplementation((sel: string) => {
      if (
        sel.includes('self::label') &&
        sel.includes('סיסמה') &&
        !sel.includes('//input') &&
        !sel.includes('following-sibling') &&
        !sel.includes('../')
      )
        return Promise.resolve({});
      if (sel.includes('//input[1]') && !sel.includes('following-sibling') && !sel.includes('../'))
        return Promise.resolve(null);
      if (sel.includes('following-sibling::input')) return Promise.resolve({});
      return Promise.resolve(null);
    });
    const locMock = jest.fn().mockImplementation((sel: string) => {
      if (sel.includes('self::label') && sel.includes('סיסמה')) {
        const loc = {
          count: jest.fn().mockResolvedValue(1),
          getAttribute: jest.fn().mockResolvedValue(null),
        };
        return { first: jest.fn().mockReturnValue(loc), count: jest.fn().mockResolvedValue(1) };
      }
      const inputLoc = {
        count: jest.fn().mockResolvedValue(1),
        evaluate: jest.fn().mockResolvedValue('input'),
        getAttribute: jest.fn().mockResolvedValue('text'),
      };
      return { first: jest.fn().mockReturnValue(inputLoc), count: jest.fn().mockResolvedValue(1) };
    });
    const page = makeLabelPage(querySelector, locMock);
    const result = await SELECTOR_MOD.resolveFieldContext(page, labelField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.resolvedKind).toBe('labelText');
  });

  it('returns null when no labeling element found', async () => {
    const mainFrame = { url: jest.fn().mockReturnValue('https://bank.test/login') };
    const emptyLoc = {
      count: jest.fn().mockResolvedValue(0),
      getAttribute: jest.fn().mockResolvedValue(null),
    };
    const page = {
      $: jest.fn().mockResolvedValue(null),
      locator: jest.fn().mockReturnValue({
        first: jest.fn().mockReturnValue(emptyLoc),
        count: jest.fn().mockResolvedValue(0),
      }),
      frames: jest.fn().mockReturnValue([mainFrame]),
      mainFrame: jest.fn().mockReturnValue(mainFrame),
      title: jest.fn().mockResolvedValue('Bank Login'),
      url: jest.fn().mockReturnValue('https://bank.test/login'),
    } as unknown as Page;
    const result = await SELECTOR_MOD.resolveFieldContext(page, labelField, 'https://bank.test/');
    expect(result.isResolved).toBe(false);
  });

  it('skips hidden inputs in nested strategy', async () => {
    const querySelector = jest.fn().mockImplementation((sel: string) => {
      if (sel.includes('self::label') && sel.includes('סיסמה') && !sel.includes('//input'))
        return Promise.resolve({});
      if (sel.includes('סיסמה') && sel.includes('//input')) return Promise.resolve({});
      if (sel.includes('following-sibling::input')) return Promise.resolve({});
      if (sel.includes('placeholder')) return Promise.resolve({});
      return Promise.resolve(null);
    });
    const locMock = jest.fn().mockImplementation((sel: string) => {
      const isLabelSel = sel.includes('//label[contains') && !sel.includes('//input');
      const isDivSpan = sel.includes('self::label') && !sel.includes('//input');
      if (isLabelSel) {
        const loc = { count: jest.fn().mockResolvedValue(0) };
        return { first: jest.fn().mockReturnValue(loc), count: jest.fn().mockResolvedValue(0) };
      }
      if (isDivSpan) {
        const loc = {
          count: jest.fn().mockResolvedValue(1),
          getAttribute: jest.fn().mockResolvedValue(null),
        };
        return { first: jest.fn().mockReturnValue(loc), count: jest.fn().mockResolvedValue(1) };
      }
      const hiddenLoc = {
        count: jest.fn().mockResolvedValue(1),
        evaluate: jest.fn().mockResolvedValue('input'),
        getAttribute: jest.fn().mockResolvedValue('hidden'),
      };
      return {
        first: jest.fn().mockReturnValue(hiddenLoc),
        count: jest.fn().mockResolvedValue(1),
      };
    });
    const page = makeLabelPage(querySelector, locMock);
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
   * @param locMock - Optional locator mock.
   * @returns A mock Page object.
   */
  function makeFallbackPage(querySelector: jest.Mock, locMock?: jest.Mock): Page {
    const mainFrame = { url: jest.fn().mockReturnValue('https://bank.test/login') };
    return {
      $: querySelector,
      locator:
        locMock ??
        jest.fn().mockReturnValue({
          first: jest.fn().mockReturnValue({
            count: jest.fn().mockResolvedValue(0),
            getAttribute: jest.fn().mockResolvedValue(null),
          }),
          count: jest.fn().mockResolvedValue(0),
        }),
      frames: jest.fn().mockReturnValue([mainFrame]),
      mainFrame: jest.fn().mockReturnValue(mainFrame),
      title: jest.fn().mockResolvedValue('Login'),
      url: jest.fn().mockReturnValue('https://bank.test/login'),
    } as unknown as Page;
  }

  it('finds input via <span>סיסמה</span> when no <label> exists', async () => {
    const querySelector = jest.fn().mockImplementation((sel: string) => {
      if (sel.includes('//label[contains')) return Promise.resolve(null);
      if (sel.includes('text()[contains')) return Promise.resolve({});
      if (sel.includes('//input')) return Promise.resolve({});
      return Promise.resolve(null);
    });
    const locMock = jest.fn().mockImplementation((sel: string) => {
      if (sel.includes('//label[contains')) {
        const loc = { count: jest.fn().mockResolvedValue(0) };
        return { first: jest.fn().mockReturnValue(loc), count: jest.fn().mockResolvedValue(0) };
      }
      if (sel.includes('text()[contains') && !sel.includes('//input')) {
        const spanLoc = {
          count: jest.fn().mockResolvedValue(1),
          getAttribute: jest.fn().mockResolvedValue(null),
        };
        return {
          first: jest.fn().mockReturnValue(spanLoc),
          count: jest.fn().mockResolvedValue(1),
        };
      }
      const inputLoc = {
        count: jest.fn().mockResolvedValue(1),
        evaluate: jest.fn().mockResolvedValue('input'),
        getAttribute: jest.fn().mockResolvedValue('text'),
      };
      return {
        first: jest.fn().mockReturnValue(inputLoc),
        count: jest.fn().mockResolvedValue(1),
      };
    });
    const page = makeFallbackPage(querySelector, locMock);
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
    const locMock = jest.fn().mockReturnValue({
      first: jest.fn().mockReturnValue({
        count: jest.fn().mockResolvedValue(0),
        getAttribute: jest.fn().mockResolvedValue(null),
      }),
      count: jest.fn().mockResolvedValue(0),
    });
    const page = makeFallbackPage(querySelector, locMock);
    const result = await SELECTOR_MOD.resolveFieldContext(page, labelField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.resolvedKind).toBe('placeholder');
  });
});
