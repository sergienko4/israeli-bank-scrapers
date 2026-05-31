/**
 * Unit tests for SelectorLabelStrategies — label/text-based input resolution.
 */

import {
  findInputByForAttr,
  isClickableElement,
  isFillableInput,
  resolveByAriaRef,
  resolveByNestedInput,
  resolveByProximity,
  resolveBySibling,
  resolveLabelStrategies,
} from '../../../../../Scrapers/Pipeline/Mediator/Selector/SelectorLabelStrategies.js';
import { makePage, MISS_QUERY, OK_QUERY } from './SelectorLabelStrategiesHelpers.js';

describe('isFillableInput', () => {
  it('returns true for textarea', async () => {
    const page = makePage({ x: { count: 1, tag: 'textarea' } });
    expect(await isFillableInput(page, 'x')).toBe(true);
  });

  it('returns true for text input', async () => {
    const page = makePage({ x: { count: 1, tag: 'input', type: 'text' } });
    expect(await isFillableInput(page, 'x')).toBe(true);
  });

  it('returns false for button input', async () => {
    const page = makePage({ x: { count: 1, tag: 'input', type: 'button' } });
    expect(await isFillableInput(page, 'x')).toBe(false);
  });

  it('returns false when count=0', async () => {
    const page = makePage({});
    expect(await isFillableInput(page, '#missing')).toBe(false);
  });

  it('returns false for non-input non-textarea tag', async () => {
    const page = makePage({ x: { count: 1, tag: 'div' } });
    expect(await isFillableInput(page, 'x')).toBe(false);
  });
});

describe('isClickableElement', () => {
  it('returns true for button tag', async () => {
    const page = makePage({ x: { count: 1, tag: 'button' } });
    expect(await isClickableElement(page, 'x')).toBe(true);
  });

  it('returns true for anchor tag', async () => {
    const page = makePage({ x: { count: 1, tag: 'a' } });
    expect(await isClickableElement(page, 'x')).toBe(true);
  });

  it('returns true for submit input', async () => {
    const page = makePage({ x: { count: 1, tag: 'input', type: 'submit' } });
    expect(await isClickableElement(page, 'x')).toBe(true);
  });

  it('returns true for role=button', async () => {
    const page = makePage({ x: { count: 1, tag: 'div', role: 'button' } });
    expect(await isClickableElement(page, 'x')).toBe(true);
  });

  it('returns true for element with tabindex', async () => {
    const page = makePage({ x: { count: 1, tag: 'div', tabindex: '0' } });
    expect(await isClickableElement(page, 'x')).toBe(true);
  });

  it('returns false for non-clickable div', async () => {
    const page = makePage({ x: { count: 1, tag: 'div' } });
    expect(await isClickableElement(page, 'x')).toBe(false);
  });

  it('returns false when count=0', async () => {
    const page = makePage({});
    expect(await isClickableElement(page, '#missing')).toBe(false);
  });
});

describe('findInputByForAttr', () => {
  it('returns empty string when input not found', async () => {
    const page = makePage({});
    const result = await findInputByForAttr(page, 'usr', 'User');
    expect(result).toBe('');
  });

  it('returns input selector when found and fillable', async () => {
    const page = makePage({
      '#usr': { count: 1, tag: 'input', type: 'text' },
    });
    const result = await findInputByForAttr(page, 'usr', 'User');
    expect(result).toBe('#usr');
  });

  it('returns empty when found but not fillable', async () => {
    const page = makePage({
      '#usr': { count: 1, tag: 'input', type: 'submit' },
    });
    const result = await findInputByForAttr(page, 'usr', 'User');
    expect(result).toBe('');
  });
});

describe('resolveByNestedInput', () => {
  it('returns empty when nested input not found', async () => {
    const page = makePage({});
    const result = await resolveByNestedInput({
      ctx: page,
      baseXpath: 'xpath=//label',
      queryFn: MISS_QUERY,
    });
    expect(result).toBe('');
  });

  it('returns xpath when nested input found and fillable', async () => {
    const page = makePage({ input: { count: 1, tag: 'input', type: 'text' } });
    const result = await resolveByNestedInput({
      ctx: page,
      baseXpath: 'xpath=//label',
      queryFn: OK_QUERY,
    });
    expect(result).toContain('xpath=');
  });
});

describe('resolveByAriaRef', () => {
  it('returns empty when label has no id', async () => {
    const label = {
      /**
       * getAttribute returns null (no id).
       * @returns Resolved null.
       */
      getAttribute: (): Promise<string | null> => Promise.resolve(null),
    };
    const page = makePage({});
    const result = await resolveByAriaRef({
      ctx: page,
      label,
      labelValue: 'User',
      queryFn: OK_QUERY,
    });
    expect(result).toBe('');
  });

  it('returns aria-labelledby selector when found', async () => {
    const label = {
      /**
       * getAttribute returns id.
       * @returns Resolved 'lblId'.
       */
      getAttribute: (): Promise<string> => Promise.resolve('lblId'),
    };
    const page = makePage({});
    const result = await resolveByAriaRef({
      ctx: page,
      label,
      labelValue: 'User',
      queryFn: OK_QUERY,
    });
    expect(result).toContain('aria-labelledby="lblId"');
  });

  it('returns empty when query misses', async () => {
    const label = {
      /**
       * getAttribute returns id.
       * @returns Resolved 'x'.
       */
      getAttribute: (): Promise<string> => Promise.resolve('x'),
    };
    const page = makePage({});
    const result = await resolveByAriaRef({
      ctx: page,
      label,
      labelValue: 'User',
      queryFn: MISS_QUERY,
    });
    expect(result).toBe('');
  });
});

describe('resolveBySibling', () => {
  it('returns empty when sibling not found', async () => {
    const page = makePage({});
    const result = await resolveBySibling({
      ctx: page,
      baseXpath: 'xpath=//label',
      queryFn: MISS_QUERY,
    });
    expect(result).toBe('');
  });

  it('returns xpath when sibling found and fillable', async () => {
    const page = makePage({ input: { count: 1, tag: 'input', type: 'text' } });
    const result = await resolveBySibling({
      ctx: page,
      baseXpath: 'xpath=//label',
      queryFn: OK_QUERY,
    });
    expect(result).toContain('following-sibling');
  });
});

describe('resolveByProximity', () => {
  it('returns empty when proximity not found', async () => {
    const page = makePage({});
    const result = await resolveByProximity({
      ctx: page,
      baseXpath: 'xpath=//label',
      queryFn: MISS_QUERY,
    });
    expect(result).toBe('');
  });

  it('returns xpath when proximity input found and fillable', async () => {
    const page = makePage({ input: { count: 1, tag: 'input', type: 'text' } });
    const result = await resolveByProximity({
      ctx: page,
      baseXpath: 'xpath=//label',
      queryFn: OK_QUERY,
    });
    expect(result).toContain('..');
  });
});

describe('resolveLabelStrategies', () => {
  it('uses for attribute when present', async () => {
    const label = {
      /**
       * getAttribute 'for' returns id.
       * @param name - Attribute.
       * @returns The ref id when queried for 'for'.
       */
      getAttribute: (name: string): Promise<string | null> => {
        if (name === 'for') return Promise.resolve('user');
        return Promise.resolve(null);
      },
    };
    const page = makePage({ '#user': { count: 1, tag: 'input', type: 'text' } });
    const result = await resolveLabelStrategies({
      ctx: page,
      label,
      baseXpath: 'xpath=//label',
      labelValue: 'User',
      queryFn: OK_QUERY,
    });
    expect(result).toBe('#user');
  });

  it('falls through to proximity when earlier strategies miss', async () => {
    const label = {
      /**
       * getAttribute always returns null.
       * @returns Resolved null.
       */
      getAttribute: (): Promise<string | null> => Promise.resolve(null),
    };
    const page = makePage({ input: { count: 1, tag: 'input', type: 'text' } });
    const result = await resolveLabelStrategies({
      ctx: page,
      label,
      baseXpath: 'xpath=//label',
      labelValue: 'User',
      queryFn: OK_QUERY,
    });
    expect(result).toContain('xpath=');
  });

  it('uses aria-ref when for/nested miss but aria-labelledby hits', async () => {
    const label = {
      /**
       * getAttribute: for → null, id → 'lbl-1' (so aria-ref can fire).
       * @param name - Attribute name.
       * @returns Resolved value.
       */
      getAttribute: (name: string): Promise<string | null> => {
        if (name === 'for') return Promise.resolve(null);
        if (name === 'id') return Promise.resolve('lbl-1');
        return Promise.resolve(null);
      },
    };
    // Page: nested input count=0, aria-ref selector hits
    let queryCount = 0;
    /**
     * First call (nested) misses, second (aria) hits.
     * @returns Scripted true/false.
     */
    const scripted = (): Promise<boolean> => {
      queryCount += 1;
      return Promise.resolve(queryCount === 2);
    };
    const page = makePage({});
    const result = await resolveLabelStrategies({
      ctx: page,
      label,
      baseXpath: 'xpath=//label',
      labelValue: 'User',
      queryFn: scripted,
    });
    expect(result).toContain('aria-labelledby');
  });

  it('uses sibling when for/nested/aria miss but sibling hits', async () => {
    const label = {
      /**
       * Return null for all attrs (no for, no id).
       * @returns Resolved null.
       */
      getAttribute: (): Promise<string | null> => Promise.resolve(null),
    };
    // Need input locator positive for sibling fillable check
    const page = makePage({ input: { count: 1, tag: 'input', type: 'text' } });
    let queryCount = 0;
    /**
     * Nested → miss, aria → miss, sibling → hit.
     * @returns Scripted.
     */
    const scripted = (): Promise<boolean> => {
      queryCount += 1;
      return Promise.resolve(queryCount >= 3);
    };
    const result = await resolveLabelStrategies({
      ctx: page,
      label,
      baseXpath: 'xpath=//label',
      labelValue: 'User',
      queryFn: scripted,
    });
    expect(result).toContain('xpath=');
  });
});
