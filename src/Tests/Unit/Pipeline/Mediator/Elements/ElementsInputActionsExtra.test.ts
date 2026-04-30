/**
 * Extra ElementsInputActions coverage — Angular helper injection, setValue,
 * and deepFillInput recovery paths (evaluate throws, focus fails).
 */

import type { Locator, Page } from 'playwright-core';

import {
  deepFillInput,
  setValue,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementsInputActions.js';

/** Pre-built locator script. */
interface ILocatorOpts {
  fillThrows?: boolean;
  pressThrows?: boolean;
  evaluateThrows?: boolean;
  siblingCount?: number;
  focusThrows?: boolean;
}

/**
 * Build a locator supporting fill/focus/pressSequentially/evaluate.
 * @param opts - Behaviour toggles.
 * @returns Mock Locator.
 */
function makeLocator(opts: ILocatorOpts = {}): Locator {
  const siblingCount = opts.siblingCount ?? 1;
  let evalIdx = 0;
  const self = {
    /**
     * first.
     * @returns Self.
     */
    first: (): Locator => self as unknown as Locator,
    /**
     * fill.
     * @returns Scripted.
     */
    fill: (): Promise<boolean> => {
      if (opts.fillThrows) return Promise.reject(new Error('fill fail'));
      return Promise.resolve(true);
    },
    /**
     * focus.
     * @returns Scripted.
     */
    focus: (): Promise<boolean> => {
      if (opts.focusThrows) return Promise.reject(new Error('focus fail'));
      return Promise.resolve(true);
    },
    /**
     * pressSequentially.
     * @returns Scripted.
     */
    pressSequentially: (): Promise<boolean> => {
      if (opts.pressThrows) return Promise.reject(new Error('press fail'));
      return Promise.resolve(true);
    },
    /**
     * evaluate — first call returns sibling count, later calls return true (or throw).
     * @returns Scripted.
     */
    evaluate: (): Promise<number | boolean> => {
      evalIdx += 1;
      if (evalIdx === 1) return Promise.resolve(siblingCount);
      if (opts.evaluateThrows) return Promise.reject(new Error('evaluate fail'));
      return Promise.resolve(true);
    },
  };
  return self as unknown as Locator;
}

/**
 * Build a Page returning the locator and supporting evaluate (for Angular helper).
 * @param loc - Locator to return.
 * @param evalThrows - Whether page.evaluate (Angular inject) throws.
 * @returns Mock Page.
 */
function makePage(loc: Locator, evalThrows = false): Page {
  return {
    /**
     * locator.
     * @returns Locator.
     */
    locator: (): Locator => loc,
    /**
     * evaluate — used by ensureAngularHelper.
     * @returns Scripted.
     */
    evaluate: (): Promise<unknown> => {
      if (evalThrows) return Promise.reject(new Error('evaluate fail'));
      return Promise.resolve(true);
    },
  } as unknown as Page;
}

describe('deepFillInput — recovery paths', () => {
  it('recovers when Angular helper injection fails', async () => {
    const loc = makeLocator({ fillThrows: false, siblingCount: 1 });
    const page = makePage(loc, true);
    const isOk = await deepFillInput(page, '#u', 'v');
    expect(isOk).toBe(true);
  });

  it('handles fallback with pressSequentially failure silently', async () => {
    const loc = makeLocator({ fillThrows: true, pressThrows: true, siblingCount: 1 });
    const page = makePage(loc);
    const isOk = await deepFillInput(page, '#u', 'v');
    expect(isOk).toBe(true);
  });

  it('PIN-buffer path with focus failure returns true', async () => {
    const loc = makeLocator({ fillThrows: false, siblingCount: 5, focusThrows: true });
    const page = makePage(loc);
    const isOk = await deepFillInput(page, '#pin', '1234');
    expect(isOk).toBe(true);
  });

  it('fallback path when safeSiblingCount evaluate throws', async () => {
    const loc = makeLocator({ fillThrows: true, evaluateThrows: true, siblingCount: 1 });
    const page = makePage(loc);
    const isOk = await deepFillInput(page, '#u', 'v');
    expect(isOk).toBe(true);
  });
});

describe('setValue', () => {
  it('calls locator.evaluate to set value', async () => {
    const loc = makeLocator({ fillThrows: false, siblingCount: 1 });
    const page = makePage(loc);
    const isOk = await setValue(page, '#u', 'raw');
    expect(isOk).toBe(true);
  });
});

// ── Invoke internal evaluate callbacks with fake DOM so setValueAndFireEvents,
//    countSiblingInputs and syncAngularModel run in the test VM. ──

/** Fake HTMLInputElement with dispatchEvent recorder. */
interface IFakeDomInput {
  value: string;
  readonly dispatched: string[];
  parentElement: { querySelectorAll: (sel: string) => { readonly length: number } } | null;
  dispatchEvent: (evt: { readonly type: string }) => boolean;
}

/**
 * Build a fake DOM input with parent and dispatchEvent tracking.
 * @param siblingCount - Number of sibling inputs (parent.querySelectorAll length).
 * @returns Fake input.
 */
function makeFakeInput(siblingCount = 1): IFakeDomInput {
  const dispatched: string[] = [];
  const parent = {
    /**
     * Test helper.
     *
     * @returns Result.
     */
    querySelectorAll: (): { readonly length: number } => ({ length: siblingCount }),
  };
  return {
    value: '',
    dispatched,
    parentElement: parent,
    /**
     * Test helper.
     *
     * @param evt - Parameter.
     * @returns Result.
     */
    dispatchEvent: function (evt): boolean {
      this.dispatched.push(evt.type);
      return true;
    },
  };
}

/**
 * Build a locator whose evaluate ACTUALLY invokes the callback.
 * Inspects the callback source for "window" references — if present, skip
 * invocation and return a safe sentinel (syncAngularModel refs `window`).
 * @param el - Fake element to pass to callback.
 * @param opts - Behaviour toggles.
 * @param opts.fillThrows - Whether fill throws.
 * @returns Mock Locator + the fake input for inspection.
 */
function makeExecLocator(
  el: IFakeDomInput,
  opts: { fillThrows?: boolean } = {},
): { loc: Locator; el: IFakeDomInput } {
  const self = {
    /**
     * Test helper.
     *
     * @returns Result.
     */
    first: (): Locator => self as unknown as Locator,
    /**
     * Test helper.
     *
     * @returns Result.
     */
    fill: (): Promise<boolean> => {
      if (opts.fillThrows) return Promise.reject(new Error('fill fail'));
      return Promise.resolve(true);
    },
    /**
     * Test helper.
     *
     * @returns Result.
     */
    focus: (): Promise<boolean> => Promise.resolve(true),
    /**
     * Test helper.
     *
     * @returns Result.
     */
    pressSequentially: (): Promise<boolean> => Promise.resolve(true),
    /**
     * Test helper.
     *
     * @param cb - Parameter.
     * @param arg - Parameter.
     * @returns Result.
     */
    evaluate: <T>(cb: (e: unknown, ...args: unknown[]) => T, arg?: unknown): Promise<T> => {
      // Skip callbacks that reference `window` (they're browser-context only).
      const src = cb.toString();
      if (src.includes('window')) return Promise.resolve(true as unknown as T);
      const cbResult1 = cb(el, arg);
      return Promise.resolve(cbResult1);
    },
  };
  return { loc: self as unknown as Locator, el };
}

describe('deepFillInput — invokes inner evaluate callbacks', () => {
  it('triggers countSiblingInputs and setValueAndFireEvents on real callback', async () => {
    const el = makeFakeInput(1);
    const { loc } = makeExecLocator(el, { fillThrows: true });
    const page = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      locator: (): Locator => loc,
      /**
       * Test helper.
       *
       * @param script - Parameter.
       * @returns Result.
       */
      evaluate: <T>(script: string | (() => T)): Promise<T | boolean> => {
        if (typeof script === 'function') {
          const scriptResult2 = script();
          return Promise.resolve(scriptResult2);
        }
        return Promise.resolve(true);
      },
    } as unknown as Page;
    const isOk = await deepFillInput(page, '#u', 'val42');
    expect(isOk).toBe(true);
    // setValueAndFireEvents body ran → dispatched input, change, blur
    expect(el.dispatched).toEqual(expect.arrayContaining(['input', 'change', 'blur']) as unknown);
    expect(el.value).toBe('val42');
  });

  it('triggers countSiblingInputs for PIN buffer (siblings > 1), skips DOM writes', async () => {
    const el = makeFakeInput(4);
    const { loc } = makeExecLocator(el);
    const page = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      locator: (): Locator => loc,
      /**
       * Test helper.
       *
       * @param cb - Parameter.
       * @returns Result.
       */
      evaluate: <T>(cb: (() => T) | string): Promise<T | boolean> => {
        if (typeof cb === 'function') {
          const cbResult4 = cb();
          return Promise.resolve(cbResult4);
        }
        return Promise.resolve(true);
      },
    } as unknown as Page;
    const isOk = await deepFillInput(page, '#pin', '1234');
    expect(isOk).toBe(true);
    // PIN-buffer branch skips setValueAndFireEvents → no dispatched events
    expect(el.dispatched.length).toBe(0);
  });

  it('setValue runs the inline evaluate callback (assigns .value, line 199)', async () => {
    const el: { value: string } = { value: '' };
    const loc = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      first: (): Locator => loc as unknown as Locator,
      /**
       * Test helper.
       *
       * @param cb - Parameter.
       * @param arg - Parameter.
       * @returns Result.
       */
      evaluate: <T>(cb: (e: unknown, v: string) => T, arg: string): Promise<T> => {
        const cbResult = cb(el, arg);
        return Promise.resolve(cbResult);
      },
    };
    const page = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      locator: (): Locator => loc as unknown as Locator,
    } as unknown as Page;
    const isOk = await setValue(page, '#x', 'written');
    expect(isOk).toBe(true);
    expect(el.value).toBe('written');
  });

  it('ensureAngularHelper catch fires when ctx.evaluate rejects (line 53)', async () => {
    // fillThrows=true → fallback path runs ensureAngularHelper → ctx.evaluate rejects.
    const el = makeFakeInput(1);
    const { loc } = makeExecLocator(el, { fillThrows: true });
    const page = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      locator: (): Locator => loc,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      evaluate: (): Promise<never> => Promise.reject(new Error('ctx eval fail')),
    } as unknown as Page;
    const isOk = await deepFillInput(page, '#u', 'v');
    expect(isOk).toBe(true);
  });

  it('locator.fill(empty) catch fires when second fill call rejects (line 167)', async () => {
    // Special locator: first fill OK, siblings>1 → clear fill call rejects
    // so the .catch lambda at line 167 fires.
    let fillIdx = 0;
    const el = makeFakeInput(3);
    const loc = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      first: (): Locator => loc as unknown as Locator,
      /**
       * Test helper.
       *
       * @param v - Parameter.
       * @returns Result.
       */
      fill: (v: string): Promise<boolean> => {
        fillIdx += 1;
        // First call (fill value) OK, second call (fill '') rejects.
        if (fillIdx === 2 && v === '') return Promise.reject(new Error('clear fail'));
        return Promise.resolve(true);
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      focus: (): Promise<boolean> => Promise.resolve(true),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      pressSequentially: (): Promise<boolean> => Promise.resolve(true),
      /**
       * Test helper.
       *
       * @param cb - Parameter.
       * @param arg - Parameter.
       * @returns Result.
       */
      evaluate: <T>(cb: (e: unknown, ...args: unknown[]) => T, arg?: unknown): Promise<T> => {
        const src = cb.toString();
        if (src.includes('window')) return Promise.resolve(true as unknown as T);
        const cbResult5 = cb(el, arg);
        return Promise.resolve(cbResult5);
      },
    };
    const page = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      locator: (): Locator => loc as unknown as Locator,
      /**
       * Test helper.
       *
       * @param cb - Parameter.
       * @returns Result.
       */
      evaluate: <T>(cb: (() => T) | string): Promise<T | boolean> => {
        if (typeof cb === 'function') {
          const cbResult6 = cb();
          return Promise.resolve(cbResult6);
        }
        return Promise.resolve(true);
      },
    } as unknown as Page;
    const isOk = await deepFillInput(page, '#pin', 'abcd');
    expect(isOk).toBe(true);
  });
});
