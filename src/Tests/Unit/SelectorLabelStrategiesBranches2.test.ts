/**
 * Additional branch coverage tests for SelectorLabelStrategies.ts.
 * Targets: resolveByContainerInput success, resolveByAncestorWalkUp first-match,
 * resolveTextContent interactive found, resolveLabelText divspan fallback,
 * resolveLabelStrategies chain: nested→aria→sibling→proximity.
 */
import { jest } from '@jest/globals';

jest.unstable_mockModule('../../Common/Debug.js', () => ({
  /**
   * Creates a mock debug logger.
   * @returns mock debug logger.
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

const MOD = await import('../../Common/SelectorLabelStrategies.js');

/**
 * Build a mock context where locator returns configurable count/evaluate/getAttribute.
 * @param count - Locator element count.
 * @param tagName - Tag name evaluate returns.
 * @param typeAttr - Input type getAttribute returns.
 * @returns Mock context object.
 */
function makeCtx(count = 0, tagName = 'div', typeAttr?: string): Record<string, jest.Mock> {
  const firstResult = {
    count: jest.fn().mockResolvedValue(count),
    evaluate: jest.fn().mockResolvedValue(tagName),
    getAttribute: jest.fn().mockResolvedValue(typeAttr),
  };
  return {
    locator: jest.fn().mockReturnValue({
      first: jest.fn().mockReturnValue(firstResult),
      count: jest.fn().mockResolvedValue(count),
    }),
  };
}

describe('resolveByContainerInput — success path', () => {
  it('returns xpath when container input is found and fillable', async () => {
    const ctx = makeCtx(1, 'input', 'text');
    const queryFn = jest.fn().mockResolvedValue(true);
    const result = await MOD.resolveByContainerInput(ctx as never, 'Username', queryFn);
    expect(result).toContain('xpath=');
    expect(result).toContain('Username');
  });

  it('returns empty when container input found but not fillable', async () => {
    const ctx = makeCtx(1, 'input', 'hidden');
    const queryFn = jest.fn().mockResolvedValue(true);
    const result = await MOD.resolveByContainerInput(ctx as never, 'Secret', queryFn);
    expect(result).toBe('');
  });
});

describe('resolveByAncestorWalkUp — button found first', () => {
  it('returns button xpath when button ancestor found', async () => {
    const queryFn = jest.fn().mockResolvedValueOnce(true);
    const result = await MOD.resolveByAncestorWalkUp(makeCtx() as never, 'Submit', queryFn);
    expect(result).toContain('//button[');
  });

  it('returns a xpath when link ancestor found (2nd try)', async () => {
    const queryFn = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const result = await MOD.resolveByAncestorWalkUp(makeCtx() as never, 'Click', queryFn);
    expect(result).toContain('//a[');
  });

  it('returns select xpath when select ancestor found (3rd try)', async () => {
    const queryFn = jest
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const result = await MOD.resolveByAncestorWalkUp(makeCtx() as never, 'Choose', queryFn);
    expect(result).toContain('//select[');
  });
});

describe('resolveTextContent — interactive path wins', () => {
  it('returns interactive result when ancestor walk-up succeeds', async () => {
    const queryFn = jest.fn().mockResolvedValueOnce(true);
    const result = await MOD.resolveTextContent(makeCtx() as never, 'Login', queryFn);
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
    const ctx = makeCtx(1);
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
    const ctx = makeCtx(0);
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
    const ctx = makeCtx(1, 'input', 'text');
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
    const ctx = makeCtx(1, 'input', 'password');
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
    const ctx = makeCtx(1, 'input', 'text');
    const queryFn = jest.fn().mockResolvedValue(true);
    const result = await MOD.resolveByNestedInput({
      ctx: ctx as never,
      baseXpath: 'xpath=//label',
      queryFn,
    });
    expect(result).toContain('//input[1]');
  });
});
