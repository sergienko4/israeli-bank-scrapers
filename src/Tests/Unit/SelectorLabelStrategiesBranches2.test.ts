/**
 * Additional branch coverage tests for SelectorLabelStrategies.ts.
 * Targets: resolveByContainerInput success, resolveByAncestorWalkUp first-match,
 * resolveTextContent interactive found, resolveLabelText divspan fallback,
 * resolveLabelStrategies chain: nested->aria->sibling->proximity.
 */
import { jest } from '@jest/globals';

import { createDebugMock, createLabelCtx } from '../MockModuleFactories.js';

jest.unstable_mockModule('../../Common/Debug.js', createDebugMock);

const MOD = await import('../../Common/SelectorLabelStrategies.js');

describe('resolveByContainerInput — success path', () => {
  it('returns xpath when container input is found and fillable', async () => {
    const ctx = createLabelCtx({ count: 1, tagName: 'input', typeAttr: 'text' });
    const queryFn = jest.fn().mockResolvedValue(true);
    const result = await MOD.resolveByContainerInput(ctx as never, 'Username', queryFn);
    expect(result).toContain('xpath=');
    expect(result).toContain('Username');
  });

  it('returns empty when container input found but not fillable', async () => {
    const ctx = createLabelCtx({ count: 1, tagName: 'input', typeAttr: 'hidden' });
    const queryFn = jest.fn().mockResolvedValue(true);
    const result = await MOD.resolveByContainerInput(ctx as never, 'Secret', queryFn);
    expect(result).toBe('');
  });

  it('returns empty for radio input (non-fillable)', async () => {
    const ctx = createLabelCtx({ count: 1, tagName: 'input', typeAttr: 'radio' });
    const queryFn = jest.fn().mockResolvedValue(true);
    const result = await MOD.resolveByContainerInput(ctx as never, 'OTP Method', queryFn);
    expect(result).toBe('');
  });

  it('returns empty for checkbox input (non-fillable)', async () => {
    const ctx = createLabelCtx({ count: 1, tagName: 'input', typeAttr: 'checkbox' });
    const queryFn = jest.fn().mockResolvedValue(true);
    const result = await MOD.resolveByContainerInput(ctx as never, 'Remember', queryFn);
    expect(result).toBe('');
  });
});

/**
 * Build a queryFn mock that returns false N times, then true.
 * @param falseCount - Number of false responses before true.
 * @returns Mocked query function.
 */
function buildQueryFn(falseCount: number): jest.Mock {
  const fn = jest.fn();
  for (let i = 0; i < falseCount; i += 1) {
    fn.mockResolvedValueOnce(false);
  }
  fn.mockResolvedValueOnce(true);
  return fn;
}

describe('resolveByAncestorWalkUp — button found first', () => {
  const ancestorCases = [
    { label: 'button (1st try)', falseCount: 0, text: 'Submit', expected: '//button[' },
    { label: 'link (2nd try)', falseCount: 1, text: 'Click', expected: '//a[' },
    { label: 'select (3rd try)', falseCount: 2, text: 'Choose', expected: '//select[' },
  ] as const;

  it.each(ancestorCases)('returns $label xpath', async ({ falseCount, text, expected }) => {
    const queryFn = buildQueryFn(falseCount);
    const ctx = createLabelCtx();
    const result = await MOD.resolveByAncestorWalkUp(ctx as never, text, queryFn);
    expect(result).toContain(expected);
  });
});

describe('resolveTextContent — interactive path wins', () => {
  it('returns interactive result when ancestor walk-up succeeds', async () => {
    const queryFn = jest.fn().mockResolvedValueOnce(true);
    const ctx = createLabelCtx();
    const result = await MOD.resolveTextContent(ctx as never, 'Login', queryFn);
    expect(result).toContain('//button[');
  });
});

describe('resolveLabelStrategies — full chain', () => {
  it('returns for-attr result when label has for attribute', async () => {
    const label = {
      getAttribute: jest
        .fn()
        .mockImplementation((name: string) => Promise.resolve(name === 'for' ? 'userId' : null)),
    };
    const ctx = createLabelCtx({ count: 1 });
    const queryFn = jest.fn().mockResolvedValue(false);
    const result = await MOD.resolveLabelStrategies({
      ctx: ctx as never,
      label: label as never,
      baseXpath: 'xpath=//label',
      labelValue: 'User',
      queryFn,
    });
    expect(result).toBe('#userId');
  });

  it('falls through to nested when no for attribute', async () => {
    const label = {
      getAttribute: jest.fn().mockResolvedValue(null),
    };
    const queryFn = jest.fn().mockResolvedValue(false);
    const ctx = createLabelCtx();
    const result = await MOD.resolveLabelStrategies({
      ctx: ctx as never,
      label: label as never,
      baseXpath: 'xpath=//label',
      labelValue: 'Pass',
      queryFn,
    });
    expect(result).toBe('');
  });
});

describe('resolveBySibling — fillable sibling found', () => {
  it('returns sibling xpath when sibling is fillable', async () => {
    const ctx = createLabelCtx({ count: 1, tagName: 'input', typeAttr: 'text' });
    const queryFn = jest.fn().mockResolvedValue(true);
    const result = await MOD.resolveBySibling({
      ctx: ctx as never,
      baseXpath: 'xpath=//label',
      queryFn,
    });
    expect(result).toContain('following-sibling');
  });
});

describe('resolveByProximity — fillable proximity found', () => {
  it('returns proximity xpath when proximity input is fillable', async () => {
    const ctx = createLabelCtx({ count: 1, tagName: 'input', typeAttr: 'password' });
    const queryFn = jest.fn().mockResolvedValue(true);
    const result = await MOD.resolveByProximity({
      ctx: ctx as never,
      baseXpath: 'xpath=//span',
      queryFn,
    });
    expect(result).toContain('..//input');
  });
});

describe('resolveByNestedInput — fillable nested found', () => {
  it('returns nested xpath when nested input is fillable', async () => {
    const ctx = createLabelCtx({ count: 1, tagName: 'input', typeAttr: 'text' });
    const queryFn = jest.fn().mockResolvedValue(true);
    const result = await MOD.resolveByNestedInput({
      ctx: ctx as never,
      baseXpath: 'xpath=//label',
      queryFn,
    });
    expect(result).toContain('//input[1]');
  });
});
