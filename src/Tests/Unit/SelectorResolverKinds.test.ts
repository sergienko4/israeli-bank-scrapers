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

// ── resolvedKind tracking — every SelectorCandidate kind ────────────────────

describe('resolvedKind tracking', () => {
  it('resolvedKind = "css" for CSS selector match', async () => {
    const page = makePage({ $: jest.fn().mockResolvedValue({}) });
    const field: IFieldConfig = {
      credentialKey: 'username',
      selectors: [{ kind: 'css', value: '#userCode' }],
    };
    const result = await SELECTOR_MOD.resolveFieldContext(page, field, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.resolvedKind).toBe('css');
  });

  it('resolvedKind = "placeholder" for placeholder match', async () => {
    const page = makePage({ $: jest.fn().mockResolvedValue({}) });
    const field: IFieldConfig = {
      credentialKey: 'username',
      selectors: [{ kind: 'placeholder', value: 'שם משתמש' }],
    };
    const result = await SELECTOR_MOD.resolveFieldContext(page, field, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.selector).toBe('input[placeholder*="שם משתמש"]');
    expect(result.resolvedKind).toBe('placeholder');
  });

  it('resolvedKind = "ariaLabel" for exact aria-label match', async () => {
    const page = makePage({ $: jest.fn().mockResolvedValue({}) });
    const field: IFieldConfig = {
      credentialKey: 'username',
      selectors: [{ kind: 'ariaLabel', value: 'שם משתמש' }],
    };
    const result = await SELECTOR_MOD.resolveFieldContext(page, field, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.selector).toBe('input[aria-label="שם משתמש"]');
    expect(result.resolvedKind).toBe('ariaLabel');
  });

  it('resolvedKind = "name" for name attribute match', async () => {
    const page = makePage({ $: jest.fn().mockResolvedValue({}) });
    const field: IFieldConfig = {
      credentialKey: 'username',
      selectors: [{ kind: 'name', value: 'username' }],
    };
    const result = await SELECTOR_MOD.resolveFieldContext(page, field, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.selector).toBe('[name="username"]');
    expect(result.resolvedKind).toBe('name');
  });

  it('resolvedKind = "xpath" for XPath match', async () => {
    const page = makePage({ $: jest.fn().mockResolvedValue({}) });
    const field: IFieldConfig = {
      credentialKey: 'username',
      selectors: [{ kind: 'xpath', value: '//input[@id="user"]' }],
    };
    const result = await SELECTOR_MOD.resolveFieldContext(page, field, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.selector).toBe('xpath=//input[@id="user"]');
    expect(result.resolvedKind).toBe('xpath');
  });

  it('resolvedKind is undefined when not resolved', async () => {
    const page = makePage({ $: jest.fn().mockResolvedValue(null) });
    const field: IFieldConfig = { credentialKey: 'unknown', selectors: [] };
    const result = await SELECTOR_MOD.resolveFieldContext(page, field, 'https://bank.test/');
    expect(result.isResolved).toBe(false);
    expect(result.resolvedKind).toBeUndefined();
  });
});

// ── Placeholder-specific edge cases ─────────────────────────────────────────

describe('placeholder resolution', () => {
  it('resolves via placeholder when it is the only candidate', async () => {
    const page = makePage({ $: jest.fn().mockResolvedValue({}) });
    const field: IFieldConfig = {
      credentialKey: 'password',
      selectors: [{ kind: 'placeholder', value: 'סיסמה' }],
    };
    const result = await SELECTOR_MOD.resolveFieldContext(page, field, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.selector).toBe('input[placeholder*="סיסמה"]');
    expect(result.resolvedKind).toBe('placeholder');
    expect(result.resolvedVia).toBe('bankConfig');
  });

  it('placeholder fallback from wellKnown when bank selectors empty', async () => {
    const findPlaceholder = jest.fn().mockImplementation((sel: string) => {
      if (sel.includes('placeholder')) return Promise.resolve({});
      return Promise.resolve(null);
    });
    const page = makePage({ $: findPlaceholder });
    const field: IFieldConfig = { credentialKey: 'password', selectors: [] };
    const result = await SELECTOR_MOD.resolveFieldContext(page, field, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.selector).toBe('input[placeholder*="סיסמה"]');
    expect(result.resolvedVia).toBe('wellKnown');
    expect(result.resolvedKind).toBe('placeholder');
  });

  it('placeholder NOT found falls through to css candidates', async () => {
    const findCss = jest.fn().mockImplementation((sel: string) => {
      if (sel === 'input[type="password"]') return Promise.resolve({});
      return Promise.resolve(null);
    });
    const page = makePage({ $: findCss });
    const field: IFieldConfig = { credentialKey: 'password', selectors: [] };
    const result = await SELECTOR_MOD.resolveFieldContext(page, field, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.selector).toBe('input[type="password"]');
    expect(result.resolvedKind).toBe('css');
  });

  it('first placeholder candidate wins over second', async () => {
    const page = makePage({ $: jest.fn().mockResolvedValue({}) });
    const field: IFieldConfig = {
      credentialKey: 'test',
      selectors: [
        { kind: 'placeholder', value: 'first' },
        { kind: 'placeholder', value: 'second' },
      ],
    };
    const result = await SELECTOR_MOD.resolveFieldContext(page, field, 'https://bank.test/');
    expect(result.isResolved).toBe(true);
    expect(result.selector).toBe('input[placeholder*="first"]');
  });
});
