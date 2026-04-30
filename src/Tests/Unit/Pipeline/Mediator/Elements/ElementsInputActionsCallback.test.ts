/**
 * Callback-invoking branch coverage for ElementsInputActions.
 * Mocks locator.evaluate to actually run the countSiblingInputs
 * and syncAngularModel callbacks under a synthetic DOM.
 */

import type { Locator, Page } from 'playwright-core';

import { deepFillInput } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementsInputActions.js';

/** Fake element with parent chain. */
interface IFakeEl {
  readonly parentElement: { readonly querySelectorAll: () => { readonly length: number } } | null;
}

/** Locator behavior script. */
interface ILocScript {
  readonly el: IFakeEl;
  readonly angularPresent?: boolean;
}

/**
 * Build a locator whose evaluate invokes the callback with a fake element.
 * The callback interface is (el, arg?) => T. First call = countSiblingInputs.
 * @param script - Behavior script.
 * @returns Mock locator.
 */
function makeCallbackLocator(script: ILocScript): Locator {
  const self = {
    /**
     * first.
     * @returns Self.
     */
    first: (): Locator => self as unknown as Locator,
    /**
     * fill.
     * @returns Void promise.
     */
    fill: (): Promise<boolean> => Promise.resolve(true),
    /**
     * focus.
     * @returns Void promise.
     */
    focus: (): Promise<boolean> => Promise.resolve(true),
    /**
     * pressSequentially.
     * @returns Void promise.
     */
    pressSequentially: (): Promise<boolean> => Promise.resolve(true),
    /**
     * evaluate: invoke callback with fake element + synthetic window + Event/Reflect.
     * Swallows callback-thrown errors so setValueAndFireEvents can fail gracefully.
     * @param fn - Callback.
     * @param arg - Optional arg.
     * @returns Callback result.
     */
    evaluate: <T>(fn: (el: IFakeEl, arg?: unknown) => T, arg?: unknown): Promise<T> => {
      const g = globalThis as unknown as { window?: unknown };
      const prev = g.window;
      // Provide a window with optional __PIPELINE_NG_SYNC__ — exercises both `if (fn)` branches.
      g.window = script.angularPresent
        ? {
            /**
             * Angular sync handle — exposed by production code.
             * @returns True after sync.
             */
            ['__PIPELINE_NG_SYNC__' as string]: (): boolean => true,
          }
        : {};
      // Give fake element dispatch/parent capabilities for setValueAndFireEvents
      const elWithEvents = {
        ...script.el,
        /**
         * Test helper.
         *
         * @returns Result.
         */
        dispatchEvent: (): boolean => true,
        value: '',
      } as unknown as IFakeEl;
      try {
        const fnResult1 = fn(elWithEvents, arg);
        return Promise.resolve(fnResult1);
      } catch {
        return Promise.resolve(true as unknown as T);
      } finally {
        g.window = prev;
      }
    },
  };
  return self as unknown as Locator;
}

/**
 * Build a page that returns the scripted locator.
 * @param loc - Locator to return.
 * @returns Mock page.
 */
function makePage(loc: Locator): Page {
  return {
    /**
     * locator.
     * @returns Loc.
     */
    locator: (): Locator => loc,
    /**
     * evaluate no-op.
     * @returns Undefined.
     */
    evaluate: (): Promise<boolean> => Promise.resolve(true),
  } as unknown as Page;
}

describe('ElementsInputActions — callback invocation branches', () => {
  it('countSiblingInputs: el.parentElement null → 1 via ?? (L124 branch 1:1)', async () => {
    const el: IFakeEl = { parentElement: null };
    const loc = makeCallbackLocator({ el });
    const page = makePage(loc);
    const isOk = await deepFillInput(page, 'input', 'hello');
    expect(isOk).toBe(true);
  });

  it('countSiblingInputs: el.parentElement.querySelectorAll returns length 3 (PIN)', async () => {
    const el: IFakeEl = {
      parentElement: {
        /**
         * Test helper.
         *
         * @returns Result.
         */
        querySelectorAll: (): { length: number } => ({ length: 3 }),
      },
    };
    const loc = makeCallbackLocator({ el, angularPresent: true });
    const page = makePage(loc);
    const isOk = await deepFillInput(page, 'input', 'hi');
    expect(isOk).toBe(true);
  });

  it('syncAngularModel: window.__PIPELINE_NG_SYNC__ absent → fn falsy branch (L76)', async () => {
    const el: IFakeEl = {
      parentElement: {
        /**
         * Test helper.
         *
         * @returns Result.
         */
        querySelectorAll: (): { length: number } => ({ length: 1 }),
      },
    };
    const loc = makeCallbackLocator({ el, angularPresent: false });
    const page = makePage(loc);
    const isOk = await deepFillInput(page, 'input', 'ab');
    expect(isOk).toBe(true);
  });
});
