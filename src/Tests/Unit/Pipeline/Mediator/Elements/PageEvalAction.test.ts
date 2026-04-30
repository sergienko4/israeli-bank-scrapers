/**
 * Unit tests for PageEvalAction — pageEval, pageEvalAll, dropdown helpers.
 */

import type { Locator, Page } from 'playwright-core';

import {
  dropdownElements,
  dropdownSelect,
  pageEval,
  pageEvalAll,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/PageEvalAction.js';

/** Configuration for the mock page/locator. */
interface IEvalScript {
  readyState: boolean;
  count: number;
  evalResult?: unknown;
  evalAllResult?: unknown;
  evalThrows?: boolean;
  evalAllThrows?: boolean;
}

/**
 * Build a mock Page that supports pageEval's workflow.
 * @param script - Behaviour script.
 * @returns Mock page.
 */
function makePage(script: IEvalScript): Page {
  /**
   * Evaluate all — returns the evalAllResult or throws.
   * @returns Evaluated value.
   */
  const evaluateAll = (): Promise<unknown> => {
    if (script.evalAllThrows) return Promise.reject(new Error('evalAll fail'));
    return Promise.resolve(script.evalAllResult);
  };
  /**
   * Evaluate — returns the evalResult or throws.
   * @returns Evaluated value.
   */
  const evaluate = (): Promise<unknown> => {
    if (script.evalThrows) return Promise.reject(new Error('eval fail'));
    return Promise.resolve(script.evalResult);
  };
  const loc: Locator = {
    /**
     * count.
     * @returns Scripted count.
     */
    count: (): Promise<number> => Promise.resolve(script.count),
    evaluateAll,
    /**
     * first.
     * @returns Self.
     */
    first: (): Locator => loc,
    evaluate,
  } as unknown as Locator;
  return {
    /**
     * waitForFunction — resolves or rejects based on readyState.
     * @returns Resolved on ready.
     */
    waitForFunction: (): Promise<boolean> => {
      if (script.readyState) return Promise.resolve(true);
      return Promise.reject(new Error('timeout'));
    },
    /**
     * locator.
     * @returns Scripted locator.
     */
    locator: (): Locator => loc,
    /**
     * Page-level evaluate.
     * @returns Scripted evaluate.
     */
    evaluate,
    /**
     * selectOption.
     * @returns Resolved void.
     */
    selectOption: (): Promise<boolean> => Promise.resolve(true),
  } as unknown as Page;
}

describe('pageEvalAll', () => {
  it('returns default when page readyState never completes', async () => {
    const page = makePage({ readyState: false, count: 0 });
    const out = await pageEvalAll(page, {
      selector: '.x',
      defaultResult: [] as unknown[],
      /**
       * Unused callback.
       * @returns Empty array.
       */
      callback: (): unknown[] => [],
    });
    expect(out).toEqual([]);
  });

  it('returns default when no elements match', async () => {
    const page = makePage({ readyState: true, count: 0 });
    const out = await pageEvalAll(page, {
      selector: '.x',
      defaultResult: ['fallback'],
      /**
       * Unused callback.
       * @returns Empty array.
       */
      callback: (): unknown[] => [],
    });
    expect(out).toEqual(['fallback']);
  });

  it('returns default when evaluateAll throws', async () => {
    const page = makePage({ readyState: true, count: 1, evalAllThrows: true });
    const out = await pageEvalAll(page, {
      selector: '.x',
      defaultResult: 0,
      /**
       * Unused callback.
       * @returns Zero.
       */
      callback: (): number => 0,
    });
    expect(out).toBe(0);
  });

  it('returns evaluateAll result on success', async () => {
    const page = makePage({ readyState: true, count: 2, evalAllResult: [1, 2] });
    const out = await pageEvalAll<number[]>(page, {
      selector: '.x',
      defaultResult: [],
      /**
       * Unused callback.
       * @returns Empty array.
       */
      callback: (): number[] => [],
    });
    expect(out).toEqual([1, 2]);
  });
});

describe('pageEval', () => {
  it('returns default when readyState fails', async () => {
    const page = makePage({ readyState: false, count: 1 });
    const out = await pageEval(page, {
      selector: '.x',
      defaultResult: 'fallback',
      /**
       * Unused callback.
       * @returns Fallback string.
       */
      callback: (): string => '',
    });
    expect(out).toBe('fallback');
  });

  it('returns default when no elements match', async () => {
    const page = makePage({ readyState: true, count: 0 });
    const out = await pageEval(page, {
      selector: '.x',
      defaultResult: 'default',
      /**
       * Unused callback.
       * @returns Default string.
       */
      callback: (): string => '',
    });
    expect(out).toBe('default');
  });

  it('returns default when evaluate throws', async () => {
    const page = makePage({ readyState: true, count: 1, evalThrows: true });
    const out = await pageEval(page, {
      selector: '.x',
      defaultResult: 'err',
      /**
       * Unused callback.
       * @returns Empty string.
       */
      callback: (): string => '',
    });
    expect(out).toBe('err');
  });

  it('returns evaluate result on success', async () => {
    const page = makePage({ readyState: true, count: 1, evalResult: 'hit' });
    const out = await pageEval(page, {
      selector: '.x',
      defaultResult: '',
      /**
       * Unused callback.
       * @returns Empty string.
       */
      callback: (): string => '',
    });
    expect(out).toBe('hit');
  });
});

describe('dropdownSelect', () => {
  it('returns true after selecting option', async () => {
    const page = makePage({ readyState: true, count: 1 });
    const isOk = await dropdownSelect(page, '#sel', 'value1');
    expect(isOk).toBe(true);
  });
});

describe('dropdownElements', () => {
  it('returns options from evaluate', async () => {
    const page = makePage({
      readyState: true,
      count: 1,
      evalResult: [{ name: 'A', value: 'a' }],
    });
    const out = await dropdownElements(page, '#sel');
    expect(out.length).toBe(1);
    expect(out[0].name).toBe('A');
  });

  it('invokes optionExtractor callback against a fake document (filter + map lambdas)', async () => {
    // Build a page.evaluate that ACTUALLY runs the cb with a fake document
    // scoped to this call so `document.querySelectorAll` returns option mocks.
    const options = [
      { value: '', text: 'Empty' }, // filter() drops this (falsy value)
      { value: 'one', text: 'One' },
      { value: 'two', text: 'Two' },
    ];
    const fakeDoc = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      querySelectorAll: (): readonly { value: string; text: string }[] => options,
    };
    const origDoc = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = fakeDoc;
    try {
      const page = {
        /**
         * Test helper.
         *
         * @returns Result.
         */
        waitForFunction: (): Promise<boolean> => Promise.resolve(true),
        /**
         * Test helper.
         *
         * @returns Result.
         */
        locator: (): Locator =>
          ({
            /**
             * Test helper.
             *
             * @returns Result.
             */
            count: (): Promise<number> => Promise.resolve(1),
            /**
             * Test helper.
             *
             * @returns Result.
             */
            first: (): Locator => ({}) as Locator,
          }) as unknown as Locator,
        /**
         * Test helper.
         *
         * @param cb - Parameter.
         * @param arg - Parameter.
         * @returns Result.
         */
        evaluate: <T>(cb: (arg: string) => T, arg: string): Promise<T> => {
          const cbResult = cb(arg);
          return Promise.resolve(cbResult);
        },
        /**
         * Test helper.
         *
         * @returns Result.
         */
        selectOption: (): Promise<boolean> => Promise.resolve(true),
      } as unknown as Page;
      const out = await dropdownElements(page, '#sel');
      expect(out).toEqual([
        { name: 'One', value: 'one' },
        { name: 'Two', value: 'two' },
      ]);
    } finally {
      (globalThis as { document?: unknown }).document = origDoc;
    }
  });
});

describe('pageEvalAll / pageEval — invokes waitForFunction readyState callback', () => {
  it('waitForFunction predicate is invoked with document.readyState=complete', async () => {
    const origDoc = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = { readyState: 'complete' };
    let hasPredicateRan = false;
    try {
      const page = {
        /**
         * Test helper.
         *
         * @param cb - Parameter.
         * @returns Result.
         */
        waitForFunction: <T>(cb: () => T): Promise<T> => {
          hasPredicateRan = true;
          const cbResult1 = cb();
          return Promise.resolve(cbResult1);
        },
        /**
         * Test helper.
         *
         * @returns Result.
         */
        locator: (): Locator =>
          ({
            /**
             * Test helper.
             *
             * @returns Result.
             */
            count: (): Promise<number> => Promise.resolve(0),
            /**
             * Test helper.
             *
             * @returns Result.
             */
            first: (): Locator => ({}) as Locator,
            /**
             * Test helper.
             *
             * @returns Result.
             */
            evaluateAll: (): Promise<unknown[]> => Promise.resolve([]),
          }) as unknown as Locator,
      } as unknown as Page;
      const out = await pageEvalAll(page, {
        selector: '.x',
        defaultResult: 'default',
        /**
         * Test helper.
         *
         * @returns Result.
         */
        callback: (): string => 'never',
      });
      expect(hasPredicateRan).toBe(true);
      expect(out).toBe('default');
    } finally {
      (globalThis as { document?: unknown }).document = origDoc;
    }
  });
});
