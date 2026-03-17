import { jest } from '@jest/globals';
import type { Page } from 'playwright-core';

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

const LABEL_MOD = await import('../../Common/SelectorLabelStrategies.js');

/**
 * Creates a mock page/frame context for label strategy tests.
 * @param locatorOverrides - Custom locator behavior.
 * @returns A mock page.
 */
function makeCtx(locatorOverrides: Record<string, jest.Mock> = {}): Page {
  const defaultFirst = {
    count: jest.fn().mockResolvedValue(0),
    getAttribute: jest.fn().mockResolvedValue(null),
    evaluate: jest.fn().mockResolvedValue('div'),
  };
  return {
    locator: jest.fn().mockReturnValue({
      first: jest.fn().mockReturnValue(defaultFirst),
      count: jest.fn().mockResolvedValue(0),
      ...locatorOverrides,
    }),
  } as unknown as Page;
}

// ── findInputByForAttr — input not found branch ─────────────────────────────

describe('findInputByForAttr — not-found branch', () => {
  it('returns empty string when input referenced by for attr does not exist', async () => {
    const ctx = makeCtx();
    const result = await LABEL_MOD.findInputByForAttr(ctx, 'nonExistentId', 'Password');
    expect(result).toBe('');
  });

  it('returns selector when input exists', async () => {
    const ctx = makeCtx({
      count: jest.fn().mockResolvedValue(1),
    });
    const result = await LABEL_MOD.findInputByForAttr(ctx, 'passField', 'Password');
    expect(result).toBe('#passField');
  });
});

// ── isFillableInput — branch coverage ────────────────────────────────────────

describe('isFillableInput — branches', () => {
  it('returns false when element not found (count=0)', async () => {
    const ctx = makeCtx();
    const isFillable = await LABEL_MOD.isFillableInput(ctx, '#missing');
    expect(isFillable).toBe(false);
  });

  it('returns true for textarea', async () => {
    const ctx = makeCtx({
      first: jest.fn().mockReturnValue({
        count: jest.fn().mockResolvedValue(1),
        evaluate: jest.fn().mockResolvedValue('textarea'),
        getAttribute: jest.fn().mockResolvedValue(null),
      }),
      count: jest.fn().mockResolvedValue(1),
    });
    const isFillable = await LABEL_MOD.isFillableInput(ctx, 'textarea#notes');
    expect(isFillable).toBe(true);
  });

  it('returns false for non-input element (e.g. div)', async () => {
    const ctx = makeCtx({
      first: jest.fn().mockReturnValue({
        count: jest.fn().mockResolvedValue(1),
        evaluate: jest.fn().mockResolvedValue('div'),
        getAttribute: jest.fn().mockResolvedValue(null),
      }),
      count: jest.fn().mockResolvedValue(1),
    });
    const isFillable = await LABEL_MOD.isFillableInput(ctx, 'div.field');
    expect(isFillable).toBe(false);
  });

  it('returns false for hidden input', async () => {
    const ctx = makeCtx({
      first: jest.fn().mockReturnValue({
        count: jest.fn().mockResolvedValue(1),
        evaluate: jest.fn().mockResolvedValue('input'),
        getAttribute: jest.fn().mockResolvedValue('hidden'),
      }),
      count: jest.fn().mockResolvedValue(1),
    });
    const isFillable = await LABEL_MOD.isFillableInput(ctx, 'input[type=hidden]');
    expect(isFillable).toBe(false);
  });

  it('returns false for submit input', async () => {
    const ctx = makeCtx({
      first: jest.fn().mockReturnValue({
        count: jest.fn().mockResolvedValue(1),
        evaluate: jest.fn().mockResolvedValue('input'),
        getAttribute: jest.fn().mockResolvedValue('submit'),
      }),
      count: jest.fn().mockResolvedValue(1),
    });
    const isFillable = await LABEL_MOD.isFillableInput(ctx, 'input[type=submit]');
    expect(isFillable).toBe(false);
  });

  it('returns false for button input', async () => {
    const ctx = makeCtx({
      first: jest.fn().mockReturnValue({
        count: jest.fn().mockResolvedValue(1),
        evaluate: jest.fn().mockResolvedValue('input'),
        getAttribute: jest.fn().mockResolvedValue('button'),
      }),
      count: jest.fn().mockResolvedValue(1),
    });
    const isFillable = await LABEL_MOD.isFillableInput(ctx, 'input[type=button]');
    expect(isFillable).toBe(false);
  });

  it('returns true for text input (type=text)', async () => {
    const ctx = makeCtx({
      first: jest.fn().mockReturnValue({
        count: jest.fn().mockResolvedValue(1),
        evaluate: jest.fn().mockResolvedValue('input'),
        getAttribute: jest.fn().mockResolvedValue('text'),
      }),
      count: jest.fn().mockResolvedValue(1),
    });
    const isFillable = await LABEL_MOD.isFillableInput(ctx, 'input[type=text]');
    expect(isFillable).toBe(true);
  });

  it('returns false for radio input', async () => {
    const ctx = makeCtx({
      first: jest.fn().mockReturnValue({
        count: jest.fn().mockResolvedValue(1),
        evaluate: jest.fn().mockResolvedValue('input'),
        getAttribute: jest.fn().mockResolvedValue('radio'),
      }),
      count: jest.fn().mockResolvedValue(1),
    });
    const isFillable = await LABEL_MOD.isFillableInput(ctx, 'input[type=radio]');
    expect(isFillable).toBe(false);
  });

  it('returns false for checkbox input', async () => {
    const ctx = makeCtx({
      first: jest.fn().mockReturnValue({
        count: jest.fn().mockResolvedValue(1),
        evaluate: jest.fn().mockResolvedValue('input'),
        getAttribute: jest.fn().mockResolvedValue('checkbox'),
      }),
      count: jest.fn().mockResolvedValue(1),
    });
    const isFillable = await LABEL_MOD.isFillableInput(ctx, 'input[type=checkbox]');
    expect(isFillable).toBe(false);
  });

  it('returns true for input with no type attribute (defaults to text)', async () => {
    const ctx = makeCtx({
      first: jest.fn().mockReturnValue({
        count: jest.fn().mockResolvedValue(1),
        evaluate: jest.fn().mockResolvedValue('input'),
        getAttribute: jest.fn().mockResolvedValue(null),
      }),
      count: jest.fn().mockResolvedValue(1),
    });
    const isFillable = await LABEL_MOD.isFillableInput(ctx, 'input');
    expect(isFillable).toBe(true);
  });
});

// ── resolveBySibling — non-fillable input branch ─────────────────────────────

describe('resolveBySibling — non-fillable sibling', () => {
  it('returns empty when sibling is found but not fillable', async () => {
    const queryFn = jest.fn().mockResolvedValue(true);
    const ctx = makeCtx({
      first: jest.fn().mockReturnValue({
        count: jest.fn().mockResolvedValue(1),
        evaluate: jest.fn().mockResolvedValue('input'),
        getAttribute: jest.fn().mockResolvedValue('hidden'),
      }),
      count: jest.fn().mockResolvedValue(1),
    });

    const result = await LABEL_MOD.resolveBySibling({
      ctx,
      baseXpath: 'xpath=//label[contains(., "סיסמה")]',
      queryFn,
    });
    expect(result).toBe('');
  });

  it('returns empty when sibling not found', async () => {
    const queryFn = jest.fn().mockResolvedValue(false);
    const ctx = makeCtx();

    const result = await LABEL_MOD.resolveBySibling({
      ctx,
      baseXpath: 'xpath=//label[contains(., "test")]',
      queryFn,
    });
    expect(result).toBe('');
  });
});

// ── resolveByProximity — non-fillable input branch ───────────────────────────

describe('resolveByProximity — non-fillable proximity input', () => {
  it('returns empty when proximity input is found but not fillable', async () => {
    const queryFn = jest.fn().mockResolvedValue(true);
    const ctx = makeCtx({
      first: jest.fn().mockReturnValue({
        count: jest.fn().mockResolvedValue(1),
        evaluate: jest.fn().mockResolvedValue('input'),
        getAttribute: jest.fn().mockResolvedValue('submit'),
      }),
      count: jest.fn().mockResolvedValue(1),
    });

    const result = await LABEL_MOD.resolveByProximity({
      ctx,
      baseXpath: 'xpath=//span[contains(., "שם")]',
      queryFn,
    });
    expect(result).toBe('');
  });

  it('returns empty when proximity input not found', async () => {
    const queryFn = jest.fn().mockResolvedValue(false);
    const ctx = makeCtx();

    const result = await LABEL_MOD.resolveByProximity({
      ctx,
      baseXpath: 'xpath=//span[contains(., "test")]',
      queryFn,
    });
    expect(result).toBe('');
  });
});
