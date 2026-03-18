/**
 * Branch coverage tests for SelectorLabelStrategies.ts.
 * Targets: findInputByForAttr (found/not-found), isFillableInput (all tag+type combos),
 * resolveBySibling (non-fillable/not-found), resolveByProximity (non-fillable/not-found).
 */
import { jest } from '@jest/globals';

import { createDebugMock, createLabelCtx } from '../MockModuleFactories.js';

jest.unstable_mockModule('../../Common/Debug.js', createDebugMock);

const LABEL_MOD = await import('../../Common/SelectorLabelStrategies.js');

// ── findInputByForAttr — input not found branch ─────────────────────────────

describe('findInputByForAttr — not-found branch', () => {
  it('returns empty string when input referenced by for attr does not exist', async () => {
    const ctx = createLabelCtx();
    const result = await LABEL_MOD.findInputByForAttr(ctx as never, 'nonExistentId', 'Password');
    expect(result).toBe('');
  });

  it('returns selector when input exists', async () => {
    const ctx = createLabelCtx({
      locatorOverrides: { count: jest.fn().mockResolvedValue(1) },
    });
    const result = await LABEL_MOD.findInputByForAttr(ctx as never, 'passField', 'Password');
    expect(result).toBe('#passField');
  });
});

// ── isFillableInput — branch coverage ────────────────────────────────────────

describe('isFillableInput — branches', () => {
  it('returns false when element not found (count=0)', async () => {
    const ctx = createLabelCtx();
    const isFillable = await LABEL_MOD.isFillableInput(ctx as never, '#missing');
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
    async (...args: readonly [string, string, string | null, boolean]) => {
      const [, tagName, typeAttr, isFillableExpected] = args;
      const ctx = createLabelCtx({
        count: 1,
        tagName,
        typeAttr,
      });
      const isFillable = await LABEL_MOD.isFillableInput(ctx as never, `${tagName}#test`);
      expect(isFillable).toBe(isFillableExpected);
    },
  );
});

// ── resolveBySibling — non-fillable input branch ─────────────────────────────

describe('resolveBySibling — non-fillable sibling', () => {
  it('returns empty when sibling is found but not fillable', async () => {
    const queryFn = jest.fn().mockResolvedValue(true);
    const ctx = createLabelCtx({ count: 1, tagName: 'input', typeAttr: 'hidden' });

    const result = await LABEL_MOD.resolveBySibling({
      ctx: ctx as never,
      baseXpath: 'xpath=//label[contains(., "סיסמה")]',
      queryFn,
    });
    expect(result).toBe('');
  });

  it('returns empty when sibling not found', async () => {
    const queryFn = jest.fn().mockResolvedValue(false);
    const ctx = createLabelCtx();

    const result = await LABEL_MOD.resolveBySibling({
      ctx: ctx as never,
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
    const ctx = createLabelCtx({ count: 1, tagName: 'input', typeAttr: 'submit' });

    const result = await LABEL_MOD.resolveByProximity({
      ctx: ctx as never,
      baseXpath: 'xpath=//span[contains(., "שם")]',
      queryFn,
    });
    expect(result).toBe('');
  });

  it('returns empty when proximity input not found', async () => {
    const queryFn = jest.fn().mockResolvedValue(false);
    const ctx = createLabelCtx();

    const result = await LABEL_MOD.resolveByProximity({
      ctx: ctx as never,
      baseXpath: 'xpath=//span[contains(., "test")]',
      queryFn,
    });
    expect(result).toBe('');
  });
});
