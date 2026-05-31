/**
 * Defensive branch coverage for the click-forensics paths added so CI-vs-
 * LOCAL diffs can prove same-element-clicked. Exercises the frameUrl(),
 * captureClickForensics() and forensics-emit branches that the broader
 * ActionExecutors test suite doesn't reach (mocks lack `url()`).
 */

import type { Frame, Locator, Page } from 'playwright-core';

import { clickElementImpl } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ActionExecutors.js';
import { makeLocator } from './ActionExecutorsHelpers.js';

/** Match the IClickForensics emitted by the production helper — verbose shape. */
interface IFakeForensicsPayload {
  readonly preClickUrl: string;
  readonly clickedTag: string;
  readonly clickedDomId: string;
  readonly clickedClasses: string;
  readonly clickedAttrs: {
    readonly name: string;
    readonly type: string;
    readonly ariaLabel: string;
    readonly title: string;
    readonly href: string;
  };
  readonly clickedOuterHtml: string;
}

/**
 * Returns a fully-populated forensics payload — mimics a real DOM snapshot.
 * @returns Stub forensics object.
 */
function makeForensicsPayload(): IFakeForensicsPayload {
  return {
    preClickUrl: '',
    clickedTag: 'BUTTON',
    clickedDomId: 'submit',
    clickedClasses: 'primary',
    clickedAttrs: {
      name: '(none)',
      type: 'submit',
      ariaLabel: 'Submit',
      title: '(none)',
      href: '(none)',
    },
    clickedOuterHtml: '<button id="submit" class="primary">OK</button>',
  };
}

/**
 * Build a Page-shaped mock with a `url()` method bound to a given impl.
 * @param urlImpl - Behaviour of the page's url() method.
 * @param locator - Locator returned by page.locator().
 * @returns Page mock.
 */
function makePageWithUrl(urlImpl: () => string, locator: Locator): Page {
  /**
   * Press stub — keyboard.
   * @returns Resolved true.
   */
  const press = (): Promise<boolean> => Promise.resolve(true);
  /**
   * Page evaluate stub.
   * @returns Resolved true.
   */
  const evaluate = (): Promise<boolean> => Promise.resolve(true);
  const self = {
    /**
     * locator stub.
     * @returns Scripted locator.
     */
    locator: (): Locator => locator,
    url: urlImpl,
    keyboard: { press },
    /**
     * page accessor.
     * @returns Self.
     */
    page: (): Page => self as unknown as Page,
    evaluate,
  };
  return self as unknown as Page;
}

/**
 * Build a Page-shaped mock WITHOUT a `url` field — exercises the
 * `typeof url !== 'function'` guard branch in `frameUrl`.
 * @param locator - Locator returned by page.locator().
 * @returns Page mock missing `url`.
 */
function makePageNoUrl(locator: Locator): Page {
  /**
   * Press stub — keyboard.
   * @returns Resolved true.
   */
  const press = (): Promise<boolean> => Promise.resolve(true);
  /**
   * Page evaluate stub.
   * @returns Resolved true.
   */
  const evaluate = (): Promise<boolean> => Promise.resolve(true);
  const self = {
    /**
     * locator stub.
     * @returns Scripted locator.
     */
    locator: (): Locator => locator,
    keyboard: { press },
    /**
     * page accessor.
     * @returns Self.
     */
    page: (): Page => self as unknown as Page,
    evaluate,
  };
  return self as unknown as Page;
}

/**
 * Locator whose evaluate returns a real forensics payload (success path).
 * Adds a `nth()` accessor so the narrowLocator nth-branch can run in tests.
 * @returns Locator with scripted evaluate + nth.
 */
function makeForensicsLocator(): Locator {
  /**
   * Evaluate returning forensics payload.
   * @returns Resolved payload.
   */
  const evaluatePayload = (): Promise<IFakeForensicsPayload> => {
    const payload = makeForensicsPayload();
    return Promise.resolve(payload);
  };
  const base = makeLocator({ evaluate: evaluatePayload });
  /**
   * nth() accessor — returns the same locator (single-match stubs).
   * @returns Same locator.
   */
  const nth = (): Locator => base;
  return Object.assign(base as object, { nth }) as unknown as Locator;
}

/**
 * Locator whose evaluate rejects (defensive `.catch` path).
 * @returns Locator that rejects on evaluate.
 */
function makeRejectingEvaluateLocator(): Locator {
  /**
   * Evaluate rejecting with a non-timeout error.
   * @returns Rejected promise.
   */
  const evaluateReject = (): Promise<IFakeForensicsPayload> => {
    const detached = Reflect.construct(Error, ['detached node']);
    return Promise.reject(detached);
  };
  return makeLocator({ evaluate: evaluateReject });
}

describe('frameUrl + captureClickForensics — defensive branches', () => {
  it('emits forensics with real preClickUrl when frame.url() is present', async () => {
    const locator = makeForensicsLocator();
    /**
     * URL impl returning a real string.
     * @returns URL string.
     */
    const urlOk = (): string => 'https://example.com/page';
    const frame = makePageWithUrl(urlOk, locator);
    const isOk = await clickElementImpl({ frame, selector: '#btn', isForce: true });
    expect(isOk).toBe(true);
  });

  it('falls back to "?" when frame.url is missing (test mocks have no url)', async () => {
    const locator = makeForensicsLocator();
    // No `url` field — frameUrl() should hit the typeof !== 'function' guard.
    const frame = makePageNoUrl(locator);
    const isOk = await clickElementImpl({ frame, selector: '#btn', isForce: true });
    expect(isOk).toBe(true);
  });

  it('falls back to "?" when frame.url() throws', async () => {
    const locator = makeForensicsLocator();
    /**
     * URL impl that throws (page closed).
     * @returns Never returns.
     */
    const urlThrow = (): string => {
      const closed = Reflect.construct(Error, ['page closed']);
      throw closed;
    };
    const frame = makePageWithUrl(urlThrow, locator);
    const isOk = await clickElementImpl({ frame, selector: '#btn', isForce: true });
    expect(isOk).toBe(true);
  });

  it('uses UNKNOWN_FORENSICS shape when the locator.evaluate rejects', async () => {
    const locator = makeRejectingEvaluateLocator();
    /**
     * URL impl returning a real string.
     * @returns URL string.
     */
    const urlOk = (): string => 'https://example.com/p';
    const frame = makePageWithUrl(urlOk, locator);
    const isOk = await clickElementImpl({ frame, selector: '#btn', isForce: true });
    expect(isOk).toBe(true);
  });

  it('natural-path click also emits forensics (isForce omitted)', async () => {
    const locator = makeForensicsLocator();
    /**
     * URL impl returning a real string.
     * @returns URL string.
     */
    const urlOk = (): string => 'https://example.com/p';
    const frame = makePageWithUrl(urlOk, locator);
    const isOk = await clickElementImpl({ frame, selector: '#btn' });
    expect(isOk).toBe(true);
  });

  it('nth-aware click selects locator.nth(N) path (covers narrowLocator branch)', async () => {
    const locator = makeForensicsLocator();
    /**
     * URL impl.
     * @returns URL string.
     */
    const urlOk = (): string => 'https://example.com/p';
    const frame = makePageWithUrl(urlOk, locator);
    const isOk = await clickElementImpl({
      frame,
      selector: '[role="button"]',
      isForce: true,
      nth: 0,
    });
    expect(isOk).toBe(true);
  });

  it('inline forensics evaluator runs locally when mock invokes the passed fn', async () => {
    /** Synthetic element with all attributes that the inline evaluator reads. */
    const fakeEl = {
      tagName: 'BUTTON',
      id: 'submit',
      className: 'primary',
      outerHTML: '<button id="submit" class="primary">OK</button>',
      /**
       * Attribute reader stub.
       * @param key - Attribute name.
       * @returns Stub value or null.
       */
      getAttribute: (key: string): string | null => {
        const map: Record<string, string> = {
          name: 'submitBtn',
          type: 'submit',
          'aria-label': 'Submit',
          title: 'Submit form',
          href: '/submit',
        };
        return map[key] ?? null;
      },
    } as unknown as Element;
    const locator = makeLocator({
      /**
       * Mock evaluate that invokes the passed inline function with the fake
       * element so the browser-side evaluator runs in Node — coverage gain.
       * @param fn - Inline browser-side function.
       * @param arg - Second argument (the max-bytes constant).
       * @returns Promise resolving to whatever the inline fn returns.
       */
      evaluate: ((fn: (el: Element, arg: unknown) => unknown, arg: unknown): Promise<unknown> => {
        const result = fn(fakeEl, arg);
        return Promise.resolve(result);
      }) as unknown as () => Promise<unknown>,
    });
    /**
     * URL impl returning a real URL string.
     * @returns URL.
     */
    const urlOk = (): string => 'https://example.com/p';
    const frame = makePageWithUrl(urlOk, locator);
    const isOk = await clickElementImpl({ frame, selector: '#btn', isForce: true });
    expect(isOk).toBe(true);
  });

  it('inline evaluator hits || / ?? fallbacks for empty-attribute element', async () => {
    /** Synthetic element with EMPTY id/className/outerHTML and null attrs —
     *  exercises the `||` and `??` fallback branches of the inline forensics
     *  evaluator. */
    const emptyEl = {
      tagName: 'DIV',
      id: '',
      className: '',
      outerHTML: '',
      /**
       * Returns null for everything to trigger the `?? '(none)'` branch.
       * @returns Null.
       */
      getAttribute: (): string | null => null,
    } as unknown as Element;
    const locator = makeLocator({
      /**
       * Mock evaluate that invokes the inline fn with the empty fake.
       * @param fn - Inline browser-side fn.
       * @param arg - Second arg.
       * @returns Result.
       */
      evaluate: ((fn: (el: Element, arg: unknown) => unknown, arg: unknown): Promise<unknown> => {
        const result = fn(emptyEl, arg);
        return Promise.resolve(result);
      }) as unknown as () => Promise<unknown>,
    });
    /**
     * URL impl.
     * @returns URL.
     */
    const urlOk = (): string => 'https://example.com/p';
    const frame = makePageWithUrl(urlOk, locator);
    const isOk = await clickElementImpl({ frame, selector: '#btn', isForce: true });
    expect(isOk).toBe(true);
  });

  it('Tier 3 inline JS-click evaluator runs when force + dispatch fail', async () => {
    /** Forensics fake — full attribute reader + outerHTML. */
    const forensicsEl = {
      tagName: 'BUTTON',
      id: 'submit',
      className: 'primary',
      outerHTML: '<button>OK</button>',
      /**
       * Stub.
       * @returns Empty.
       */
      getAttribute: (): string | null => null,
    } as unknown as Element;
    /** Tier-3 click target — only needs click(). */
    const clickable = {
      /**
       * Click noop.
       * @returns void.
       */
      click: (): void => undefined,
    } as unknown as HTMLElement;
    let didEvaluateRunBrowserFn = false;
    const locator = makeLocator({
      /**
       * Force click rejects → fall to Tier 2.
       * @returns Rejected.
       */
      click: (): Promise<boolean> => {
        const failure = Reflect.construct(Error, ['t1 fail']);
        return Promise.reject(failure);
      },
      /**
       * Tier 2 dispatch rejects → fall to Tier 3.
       * @returns Rejected.
       */
      dispatchEvent: (): Promise<boolean> => {
        const failure = Reflect.construct(Error, ['t2 fail']);
        return Promise.reject(failure);
      },
      /**
       * Mock evaluate routes by inline-fn source: forensics pass uses
       * outerHTML so we feed the forensicsEl; Tier-3 fn uses .click() so
       * we feed the clickable element.
       * @param fn - Inline fn.
       * @param arg - Optional second arg (max-bytes constant for forensics).
       * @returns Result.
       */
      evaluate: ((
        fn: (el: Element | HTMLElement, arg?: unknown) => unknown,
        arg?: unknown,
      ): Promise<unknown> => {
        const src = String(fn);
        const isClickFn = src.includes('.click()');
        if (isClickFn) {
          didEvaluateRunBrowserFn = true;
          const didClick = fn(clickable);
          return Promise.resolve(didClick);
        }
        const result = fn(forensicsEl, arg);
        return Promise.resolve(result);
      }) as unknown as () => Promise<unknown>,
    });
    /**
     * URL impl.
     * @returns URL.
     */
    const urlOk = (): string => 'https://example.com/p';
    const frame = makePageWithUrl(urlOk, locator);
    const isOk = await clickElementImpl({ frame, selector: '#btn', isForce: true });
    expect(isOk).toBe(true);
    expect(didEvaluateRunBrowserFn).toBe(true);
  });

  it('Frame-style mock (page() accessor) — exercises non-Page url branch', async () => {
    const locator = makeForensicsLocator();
    /**
     * Frame URL impl.
     * @returns URL string.
     */
    const frameUrlImpl = (): string => 'https://example.com/iframe';
    /**
     * Locator stub.
     * @returns Configured locator.
     */
    const localLocator = (): Locator => locator;
    /**
     * Owning-page accessor.
     * @returns Page mock.
     */
    const ownerPage = (): Page => makePageWithUrl((): string => 'parent', locator);
    const baseFrame: Frame = {
      url: frameUrlImpl,
      locator: localLocator,
      page: ownerPage,
    } as unknown as Frame;
    const isOk = await clickElementImpl({ frame: baseFrame, selector: '#btn', isForce: true });
    expect(isOk).toBe(true);
  });
});
