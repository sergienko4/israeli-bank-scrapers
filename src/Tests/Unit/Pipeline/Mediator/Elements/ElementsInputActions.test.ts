/**
 * Unit tests for ElementsInputActions — deepFillInput + setValue paths.
 */

import type { Locator, Page } from 'playwright-core';

import {
  deepFillInput,
  fillInput,
  setValue,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementsInputActions.js';

/** Behaviour toggles for the mock locator. */
interface ILocScript {
  fillOk: boolean;
  siblingCount: number;
  pressOk: boolean;
  evaluateOk: boolean;
}

/**
 * Build a mock Locator with scripted fill/pressSequentially/evaluate.
 * @param script - Behaviour.
 * @returns Mock Locator.
 */
function makeLocator(script: ILocScript): Locator {
  /** Counter for tracking evaluate calls. */
  let evalCount = 0;
  const self = {
    /**
     * First.
     * @returns Self.
     */
    first: (): Locator => self as unknown as Locator,
    /**
     * Fill.
     * @returns Script-controlled fill.
     */
    fill: (): Promise<boolean> => {
      if (script.fillOk) return Promise.resolve(true);
      return Promise.reject(new Error('fill fail'));
    },
    /**
     * Focus.
     * @returns Resolved.
     */
    focus: (): Promise<boolean> => Promise.resolve(true),
    /**
     * pressSequentially.
     * @returns Script-controlled press.
     */
    pressSequentially: (): Promise<boolean> => {
      if (script.pressOk) return Promise.resolve(true);
      return Promise.reject(new Error('press fail'));
    },
    /**
     * evaluate — returns sibling count on first call, then void.
     * @returns Sibling count or resolved value.
     */
    evaluate: (): Promise<number | boolean> => {
      evalCount += 1;
      if (evalCount === 1) return Promise.resolve(script.siblingCount);
      if (!script.evaluateOk) return Promise.reject(new Error('evaluate fail'));
      return Promise.resolve(true);
    },
  };
  return self as unknown as Locator;
}

/**
 * Build a mock Page that returns the provided locator and resolves evaluate.
 * @param loc - Locator to return.
 * @returns Mock Page.
 */
function makePage(loc: Locator): Page {
  return {
    /**
     * locator.
     * @returns Mock locator.
     */
    locator: (): Locator => loc,
    /**
     * evaluate.
     * @returns Resolved.
     */
    evaluate: (): Promise<boolean> => Promise.resolve(true),
  } as unknown as Page;
}

describe('deepFillInput', () => {
  it('returns true after Playwright .fill() success with single sibling', async () => {
    const loc = makeLocator({ fillOk: true, siblingCount: 1, pressOk: true, evaluateOk: true });
    const page = makePage(loc);
    const isOk = await deepFillInput(page, '#u', 'val');
    expect(isOk).toBe(true);
  });

  it('falls through to fallback when .fill() times out', async () => {
    const loc = makeLocator({ fillOk: false, siblingCount: 1, pressOk: true, evaluateOk: true });
    const page = makePage(loc);
    const isOk = await deepFillInput(page, '#u', 'v');
    expect(isOk).toBe(true);
  });

  it('PIN-buffer detection: skips DOM/Angular overwrite when siblings > 1', async () => {
    const loc = makeLocator({ fillOk: true, siblingCount: 4, pressOk: true, evaluateOk: true });
    const page = makePage(loc);
    const isOk = await deepFillInput(page, '#pin', '1234');
    expect(isOk).toBe(true);
  });

  it('handles pressSequentially failures silently', async () => {
    const loc = makeLocator({ fillOk: false, siblingCount: 1, pressOk: false, evaluateOk: true });
    const page = makePage(loc);
    const isOk = await deepFillInput(page, '#u', 'v');
    expect(isOk).toBe(true);
  });

  it('fillInput alias behaves identically to deepFillInput', async () => {
    const loc = makeLocator({ fillOk: true, siblingCount: 1, pressOk: true, evaluateOk: true });
    const page = makePage(loc);
    const isOk = await fillInput(page, '#u', 'v');
    expect(isOk).toBe(true);
  });
});

describe('setValue', () => {
  it('calls locator.evaluate to set value and returns true', async () => {
    const loc = makeLocator({ fillOk: true, siblingCount: 1, pressOk: true, evaluateOk: true });
    const page = makePage(loc);
    const isOk = await setValue(page, '#u', 'raw');
    expect(isOk).toBe(true);
  });
});
