/**
 * Unit tests for SelectorLabelStrategies — fall-through + walk-up branches (split).
 */

import {
  resolveByAncestorWalkUp,
  resolveByContainerInput,
  resolveByNestedInput,
  resolveByProximity,
  resolveBySibling,
  resolveLabelStrategies,
} from '../../../../../Scrapers/Pipeline/Mediator/Selector/SelectorLabelStrategies.js';
import { makePage, OK_QUERY } from './SelectorLabelStrategiesHelpers.js';

describe('label strategies — !isFillable fall-through branches', () => {
  it('resolveByNestedInput returns empty when input is not fillable (submit)', async () => {
    // input type=submit → isFillableInput returns false
    const page = makePage({ input: { count: 1, tag: 'input', type: 'submit' } });
    const result = await resolveByNestedInput({
      ctx: page,
      baseXpath: 'xpath=//label',
      queryFn: OK_QUERY,
    });
    expect(result).toBe('');
  });

  it('resolveBySibling returns empty when sibling is not fillable (button input)', async () => {
    const page = makePage({ input: { count: 1, tag: 'input', type: 'button' } });
    const result = await resolveBySibling({
      ctx: page,
      baseXpath: 'xpath=//label',
      queryFn: OK_QUERY,
    });
    expect(result).toBe('');
  });

  it('resolveByProximity returns empty when proximity input is not fillable (hidden)', async () => {
    const page = makePage({ input: { count: 1, tag: 'input', type: 'hidden' } });
    const result = await resolveByProximity({
      ctx: page,
      baseXpath: 'xpath=//label',
      queryFn: OK_QUERY,
    });
    expect(result).toBe('');
  });

  it('resolveByContainerInput returns empty when found element is not fillable', async () => {
    // isFillableInput checks meta.tag === 'input' — a div returns false
    const page = makePage({ ancestor: { count: 1, tag: 'div' } });
    const result = await resolveByContainerInput(page, 'Label', OK_QUERY);
    expect(result).toBe('');
  });

  it('resolveLabelStrategies falls through to proximity when sibling is not fillable', async () => {
    const label = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getAttribute: (): Promise<string | null> => Promise.resolve(null),
    };
    // input is NOT fillable → sibling returns '' → proximity branch taken
    const page = makePage({ input: { count: 1, tag: 'input', type: 'submit' } });
    const result = await resolveLabelStrategies({
      ctx: page,
      label,
      baseXpath: 'xpath=//label',
      labelValue: 'User',
      queryFn: OK_QUERY,
    });
    expect(result).toBe('');
  });
});

describe('resolveByAncestorWalkUp — each ancestor probe action fires', () => {
  it('returns "a" anchor path when "button" ancestor misses', async () => {
    let call = 0;
    /**
     * Test helper.
     *
     * @returns Result.
     */
    const queryFn = (): Promise<boolean> => {
      call += 1;
      // button → miss, a → hit
      return Promise.resolve(call >= 2);
    };
    const page = makePage({});
    const result = await resolveByAncestorWalkUp(page, 'Log In', queryFn);
    expect(result).toContain('//a[');
  });

  it('returns "select" when button + a miss', async () => {
    let call = 0;
    /**
     * Test helper.
     *
     * @returns Result.
     */
    const queryFn = (): Promise<boolean> => {
      call += 1;
      // button → miss, a → miss, select → hit
      return Promise.resolve(call >= 3);
    };
    const page = makePage({});
    const result = await resolveByAncestorWalkUp(page, 'Sel', queryFn);
    expect(result).toContain('//select[');
  });
});
