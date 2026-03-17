/**
 * Branch coverage tests for SelectorLabelStrategies.ts.
 * Targets: findInputByForAttr (found/not-found), isFillableInput (all tag+type combos),
 * resolveBySibling (non-fillable/not-found), resolveByProximity (non-fillable/not-found).
 */
import { jest } from '@jest/globals';
import type { Page } from 'playwright-core';

import { createDebugMock } from '../MockModuleFactories.js';

jest.unstable_mockModule('../../Common/Debug.js', createDebugMock);

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

  const fillableCases = [
    ['textarea', 'textarea', null, true],
    ['div (non-input)', 'div', null, false],
    ['hidden input', 'input', 'hidden', false],
    ['submit input', 'input', 'submit', false],
    ['button input', 'input', 'button', false],
    ['radio input', 'input', 'radio', false],
    ['checkbox input', 'input', 'checkbox', false],
    ['text input', 'input', 'text', true],
    ['no type (defaults to text)', 'input', null, true],
  ] as const;

  it.each(fillableCases)(
    'returns correct result for %s',
    async (...args: [string, string, string | null, boolean]) => {
      const [, tagName, typeAttr, isExpectedFillable] = args;
      const ctx = makeCtx({
        first: jest.fn().mockReturnValue({
          count: jest.fn().mockResolvedValue(1),
          evaluate: jest.fn().mockResolvedValue(tagName),
          getAttribute: jest.fn().mockResolvedValue(typeAttr),
        }),
        count: jest.fn().mockResolvedValue(1),
      });
      const isFillable = await LABEL_MOD.isFillableInput(ctx, `${tagName}#test`);
      expect(isFillable).toBe(isExpectedFillable);
    },
  );
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
