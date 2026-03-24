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

/**
 * Creates a mock page for fillable input validation tests.
 * @param querySelector - The mock querySelector function.
 * @param locatorMock - The mock locator function.
 * @returns A mock Page object.
 */
function makeLabelPage(querySelector: jest.Mock, locatorMock: jest.Mock): Page {
  const mainFrame = { url: jest.fn().mockReturnValue('https://bank.test/login') };
  return {
    $: querySelector,
    locator: locatorMock,
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
  return jest.fn().mockImplementation((sel: string) => {
    if (sel.includes('//label[contains')) return Promise.resolve({});
    if (sel.includes('//input')) return Promise.resolve({});
    return Promise.resolve(null);
  });
}

/**
 * Creates a locator mock for isFillableInput + resolveLabelText tests.
 * @param tagName - The tag name to return from evaluate.
 * @param type - The input type to return from getAttribute('type').
 * @returns A jest.Mock configured as a locator factory.
 */
function makeLocatorMock(tagName: string, type?: string): jest.Mock {
  return jest.fn().mockImplementation((sel: string) => {
    const isLabelXpath = sel.includes('//label[contains') && !sel.includes('//input');
    const isStrictText = sel.includes('self::label') && !sel.includes('//input');
    if (isLabelXpath || isStrictText) {
      const labelLoc = {
        count: jest.fn().mockResolvedValue(1),
        getAttribute: jest.fn().mockResolvedValue(null),
      };
      return { first: jest.fn().mockReturnValue(labelLoc), count: jest.fn().mockResolvedValue(1) };
    }
    const inputLoc = {
      count: jest.fn().mockResolvedValue(1),
      evaluate: jest.fn().mockResolvedValue(tagName),
      getAttribute: jest.fn().mockResolvedValue(type ?? 'text'),
    };
    return { first: jest.fn().mockReturnValue(inputLoc), count: jest.fn().mockResolvedValue(1) };
  });
}

/**
 * Adds placeholder fallback support to a querySelector mock.
 * @param querySelector - The mock to enhance with placeholder support.
 * @returns The enhanced mock with placeholder fallback.
 */
function addPlaceholderFallback(querySelector: jest.Mock): jest.Mock {
  const originalImpl = querySelector.getMockImplementation() as (_: string) => Promise<object>;
  querySelector.mockImplementation((sel: string) => {
    if (sel.includes('placeholder')) return Promise.resolve({});
    return originalImpl(sel);
  });
  return querySelector;
}

/**
 * Creates a mock page for textContent strategy tests.
 * @param querySelector - The mock querySelector function.
 * @param locMock - Optional locator mock for isFillableInput.
 * @returns A mock Page object.
 */
function makeTextPage(querySelector: jest.Mock, locMock?: jest.Mock): Page {
  const mainFrame = { url: jest.fn().mockReturnValue('https://bank.test/login') };
  return {
    $: querySelector,
    locator: locMock ?? jest.fn(),
    frames: jest.fn().mockReturnValue([mainFrame]),
    mainFrame: jest.fn().mockReturnValue(mainFrame),
    title: jest.fn().mockResolvedValue('Login'),
    url: jest.fn().mockReturnValue('https://bank.test/login'),
  } as unknown as Page;
}

// ── isFillableInput validation ──────────────────────────────────────────────

describe('isFillableInput (via nested input strategy)', () => {
  const labelField: IFieldConfig = { credentialKey: 'password', selectors: [] };

  it('accepts <input type="text"> (fillable)', async () => {
    const labelQuery = makeQuerySelectorWithLabel();
    const locMock = makeLocatorMock('input', 'text');
    const page = makeLabelPage(labelQuery, locMock);
    const result = await SELECTOR_MOD.resolveFieldContext(page, labelField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.resolvedKind).toBe('labelText');
  });

  it('accepts <textarea> (fillable)', async () => {
    const labelQuery = makeQuerySelectorWithLabel();
    const locMock = makeLocatorMock('textarea');
    const page = makeLabelPage(labelQuery, locMock);
    const result = await SELECTOR_MOD.resolveFieldContext(page, labelField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.resolvedKind).toBe('labelText');
  });

  it('rejects <input type="submit"> (not fillable)', async () => {
    const baseQuery = makeQuerySelectorWithLabel();
    const querySelector = addPlaceholderFallback(baseQuery);
    const locMock = makeLocatorMock('input', 'submit');
    const page = makeLabelPage(querySelector, locMock);
    const result = await SELECTOR_MOD.resolveFieldContext(page, labelField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.resolvedKind).toBe('placeholder');
  });

  it('rejects <input type="hidden"> (not fillable)', async () => {
    const baseQuery = makeQuerySelectorWithLabel();
    const querySelector = addPlaceholderFallback(baseQuery);
    const locMock = makeLocatorMock('input', 'hidden');
    const page = makeLabelPage(querySelector, locMock);
    const result = await SELECTOR_MOD.resolveFieldContext(page, labelField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.resolvedKind).toBe('placeholder');
  });

  it('rejects <input type="radio"> (not fillable)', async () => {
    const baseQuery = makeQuerySelectorWithLabel();
    const querySelector = addPlaceholderFallback(baseQuery);
    const locMock = makeLocatorMock('input', 'radio');
    const page = makeLabelPage(querySelector, locMock);
    const result = await SELECTOR_MOD.resolveFieldContext(page, labelField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.resolvedKind).toBe('placeholder');
  });

  it('rejects <input type="checkbox"> (not fillable)', async () => {
    const baseQuery = makeQuerySelectorWithLabel();
    const querySelector = addPlaceholderFallback(baseQuery);
    const locMock = makeLocatorMock('input', 'checkbox');
    const page = makeLabelPage(querySelector, locMock);
    const result = await SELECTOR_MOD.resolveFieldContext(page, labelField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.resolvedKind).toBe('placeholder');
  });

  it('rejects <div> element (not input/textarea)', async () => {
    const baseQuery = makeQuerySelectorWithLabel();
    const querySelector = addPlaceholderFallback(baseQuery);
    const locMock = makeLocatorMock('div');
    const page = makeLabelPage(querySelector, locMock);
    const result = await SELECTOR_MOD.resolveFieldContext(page, labelField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.resolvedKind).toBe('placeholder');
  });
});

// ── resolveByAncestorWalkUp / resolveByContainerInput ───────────────────────

describe('textContent walk-up strategies (imported from SelectorLabelStrategies)', () => {
  it('textContent candidate resolves button via walk-up — resolvedKind:textContent', async () => {
    const querySelector = jest.fn().mockImplementation((sel: string) => {
      if (sel.includes('button') && sel.includes('כניסה')) return Promise.resolve({});
      return Promise.resolve(null);
    });
    const page = makeTextPage(querySelector);
    const submitField: IFieldConfig = {
      credentialKey: '__submit__',
      selectors: [{ kind: 'textContent', value: 'כניסה' }],
    };
    const result = await SELECTOR_MOD.resolveFieldContext(page, submitField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.resolvedKind).toBe('textContent');
    expect(result.selector).toContain('button');
    expect(result.selector).toContain('כניסה');
  });

  it('textContent returns not resolved when no interactive ancestor found', async () => {
    const nullMock = jest.fn().mockResolvedValue(null);
    const page = makeTextPage(nullMock);
    const submitField: IFieldConfig = {
      credentialKey: '__submit__',
      selectors: [{ kind: 'textContent', value: 'nonexistent' }],
    };
    const result = await SELECTOR_MOD.resolveFieldContext(page, submitField, 'https://bank.test/');
    expect(result.isResolved).toBe(false);
  });

  it('textContent resolves link via walk-up when button not found', async () => {
    const querySelector = jest.fn().mockImplementation((sel: string) => {
      if (sel.includes('//a[') && sel.includes('כניסה')) return Promise.resolve({});
      return Promise.resolve(null);
    });
    const page = makeTextPage(querySelector);
    const submitField: IFieldConfig = {
      credentialKey: '__submit__',
      selectors: [{ kind: 'textContent', value: 'כניסה' }],
    };
    const result = await SELECTOR_MOD.resolveFieldContext(page, submitField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.resolvedKind).toBe('textContent');
    expect(result.selector).toContain('//a[');
  });

  it('textContent resolves container input when no interactive ancestor', async () => {
    const querySelector = jest.fn().mockImplementation((sel: string) => {
      if (sel.includes('ancestor::*[.//input')) return Promise.resolve({});
      return Promise.resolve(null);
    });
    const locMock = makeLocatorMock('input', 'text');
    const page = makeTextPage(querySelector, locMock);
    const inputField: IFieldConfig = {
      credentialKey: 'password',
      selectors: [{ kind: 'textContent', value: 'סיסמה' }],
    };
    const result = await SELECTOR_MOD.resolveFieldContext(page, inputField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.resolvedKind).toBe('textContent');
  });
});
