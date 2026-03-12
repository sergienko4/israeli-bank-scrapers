import { jest } from '@jest/globals';
import type { Page } from 'playwright';

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
}));

const SELECTOR_MOD = await import('../../Common/SelectorResolver.js');

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

// ── resolveByAncestorWalkUp / resolveByContainerInput ───────────────────────

describe('textContent walk-up strategies (imported from SelectorLabelStrategies)', () => {
  /**
   * Creates a mock page for textContent strategy tests.
   * @param querySelector - The mock querySelector function.
   * @returns A mock Page object.
   */
  function makeTextPage(querySelector: jest.Mock): Page {
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
    const page = makeTextPage(querySelector);
    (page.$eval as jest.Mock).mockResolvedValueOnce('input').mockResolvedValueOnce('text');
    const inputField: IFieldConfig = {
      credentialKey: 'password',
      selectors: [{ kind: 'textContent', value: 'סיסמה' }],
    };
    const result = await SELECTOR_MOD.resolveFieldContext(page, inputField, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.resolvedKind).toBe('textContent');
  });
});
