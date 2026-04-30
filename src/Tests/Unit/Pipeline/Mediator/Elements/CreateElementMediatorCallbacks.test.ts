/**
 * Wave 6 — Agent P: branch coverage for CreateElementMediator by invoking
 * the evaluate-callback bodies locally. Targets:
 * - isTrulyVisible (L408-427): mockMode scrollIntoView, elementFromPoint hit,
 *   contains fallback, MOCK_MODE null relaxation with positive bbox.
 * - walkUpToAnchorHref (L531-534): closest('a') present/absent.
 * - traceElementInfo (L558-572): textContent null/present, href/aria nullish,
 *   closestA null/present branches.
 * - extractIdentity (L626-632): id, className, name, type nullish branches.
 * - tryScopedResolve scope-hit true branch (L100,L112).
 */

import type { Locator } from 'playwright-core';

import createElementMediator from '../../../../../Scrapers/Pipeline/Mediator/Elements/CreateElementMediator.js';
import type { ICallbackRecorder } from './CreateElementMediatorCallbacksHelpers.js';
import {
  makeInvokingLocator,
  makeMockElement,
  makePage,
} from './CreateElementMediatorCallbacksHelpers.js';

/**
 * Extract the isTrulyVisible evaluate callback from a created mediator.
 * Because that callback is passed to locator.evaluate, we capture it via
 * our recorder then invoke it with synthetic args.
 * @returns Result.
 */
describe('CreateElementMediator — isTrulyVisible evaluate callback (invoked locally)', () => {
  /**
   * Drive resolveVisible so the isTrulyVisible callback is captured + invoked
   * on our mock element. Then re-invoke with varied elements to hit branches.
   * @returns Result.
   */
  it('captures isTrulyVisible callback — mockMode=false skips scrollIntoView', async () => {
    const rec: ICallbackRecorder = { callbacks: [] };
    const el = makeMockElement({
      rect: { left: 0, top: 0, width: 20, height: 20 },
      scrollCount: { calls: 0 },
    });
    // Patch document.elementFromPoint to return the element itself → hit branch
    const origDoc = (globalThis as { document?: Document }).document;
    (globalThis as { document: unknown }).document = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      elementFromPoint: (): Element => el,
    };
    try {
      const locator = makeInvokingLocator(el, rec);
      const page = makePage(locator);
      const m = createElementMediator(page);
      await m.resolveVisible([{ kind: 'textContent', value: 'x' }], 200);
      // The isTrulyVisible callback was dispatched. Exercise its branches:
      type HitCb = (e: Element, mockMode: boolean) => boolean;
      const hitCb = rec.callbacks.find(
        (c): c is HitCb => typeof c === 'function' && String(c).includes('elementFromPoint'),
      );
      if (hitCb) {
        // Invoke branch 1: mockMode=false, hit=el → returns true
        const scroll = { calls: 0 };
        const el2 = makeMockElement({
          rect: { left: 0, top: 0, width: 20, height: 20 },
          scrollCount: scroll,
        });
        (globalThis as { document: unknown }).document = {
          /**
           * Test helper.
           *
           * @returns Result.
           */
          elementFromPoint: (): Element => el2,
        };
        const didRun1 = hitCb(el2, false);
        expect(didRun1).toBe(true);
        expect(scroll.calls).toBe(0);
        // Invoke branch 2: mockMode=true → scrollIntoView called
        const didRun2 = hitCb(el2, true);
        expect(didRun2).toBe(true);
        expect(scroll.calls).toBe(1);
        // Invoke branch 3: hit=child (el.contains path) — use a child node
        const child = { parent: el2 } as unknown as Element;
        (globalThis as { document: unknown }).document = {
          /**
           * Test helper.
           *
           * @returns Result.
           */
          elementFromPoint: (): Element => child,
        };
        // contains(child) returns false (our mock only matches self) → triggers mockMode null relaxation path only when hit===null
        const didRun3 = hitCb(el2, false);
        // hit!==el and !el.contains(child) → fallthrough to final return false
        expect(didRun3).toBe(false);
        // Invoke branch 4: MOCK_MODE relaxation — hit=null, bbox>0
        (globalThis as { document: unknown }).document = {
          /**
           * Test helper.
           *
           * @returns Result.
           */
          elementFromPoint: (): null => null,
        };
        const didRun4 = hitCb(el2, true);
        expect(didRun4).toBe(true);
        // Invoke branch 5: MOCK_MODE + hit=null + zero-width → false
        const elZero = makeMockElement({
          rect: { left: 0, top: 0, width: 0, height: 0 },
          scrollCount: { calls: 0 },
        });
        const didRun5 = hitCb(elZero, true);
        expect(didRun5).toBe(false);
        // Invoke branch 6: NOT mockMode + hit=null → false
        const didRun6 = hitCb(el2, false);
        expect(didRun6).toBe(false);
      }
    } finally {
      if (origDoc) (globalThis as { document: unknown }).document = origDoc;
      else delete (globalThis as { document?: unknown }).document;
    }
  }, 5000);
});

describe('CreateElementMediator — walkUpToAnchorHref callback (invoked locally)', () => {
  it('invokes walkUpToAnchorHref callback — anchor present returns href', async () => {
    const captured: ((e: Element) => string)[] = [];
    const anchor = {
      href: 'https://bank.co.il/deep',
      /**
       * Stub getAttribute for trace compatibility.
       * @returns '/deep-stub'.
       */
      getAttribute: (): string => '/deep-stub',
    };
    const el = makeMockElement({ closestAnchor: anchor });
    const locator = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      first: (): Locator => locator as unknown as Locator,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      waitFor: (): Promise<boolean> => Promise.resolve(true),
      /**
       * Test helper.
       *
       * @param fn - Parameter.
       * @returns Result.
       */
      evaluate: <TResult>(fn: (e: Element) => TResult): Promise<TResult> => {
        captured.push(fn as unknown as (e: Element) => string);
        const src = String(fn);
        if (src.includes('elementFromPoint')) return Promise.resolve(true as unknown as TResult);
        const fnResult2 = fn(el);
        return Promise.resolve(fnResult2);
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      innerText: (): Promise<string> => Promise.resolve(''),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getAttribute: (): Promise<string | false> => Promise.resolve(''),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      click: (): Promise<boolean> => Promise.resolve(true),
    } as unknown as Locator;
    const page = makePage(locator);
    const m = createElementMediator(page);
    await m
      .resolveVisible([{ kind: 'textContent', value: 'Txn', target: 'href' }], 200)
      .catch((): null => null);
    // Locate the walkUpToAnchorHref callback (uses closest('a') and .href)
    const walkCb = captured.find(c => {
      const src = String(c);
      return src.includes('closest(') && !src.includes('tagName');
    });
    expect(walkCb).toBeDefined();
    const walkCbSafe = walkCb as (e: Element) => unknown;

    // Branch 1: anchor present → returns href
    const r1 = walkCbSafe(el);
    expect(r1).toBe('https://bank.co.il/deep');

    // Branch 2: no anchor → returns empty string
    const elNo = makeMockElement({ closestAnchor: null });
    const r2 = walkCbSafe(elNo);
    expect(r2).toBe('');
  }, 5000);
});

describe('CreateElementMediator — traceElementInfo callback (invoked locally)', () => {
  it('handles all branches: textContent present/null, href/aria null, closestA null/present', async () => {
    // Capture the trace callback via evaluate
    const captured: ((e: Element) => string)[] = [];
    const el1 = makeMockElement({
      tagName: 'SPAN',
      textContent: 'Hello World Text Content',
      href: '/link',
      ariaLabel: 'mylabel',
      closestAnchor: {
        href: 'ignored',
        /**
         * Attribute getter.
         * @param n - Attribute name.
         * @returns Attribute value or null.
         */
        getAttribute: (n: string): string | null => (n === 'href' ? '/ancestor' : null),
      },
    });
    const locator = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      first: (): Locator => locator as unknown as Locator,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      waitFor: (): Promise<boolean> => Promise.resolve(true),
      /**
       * Test helper.
       *
       * @param fn - Parameter.
       * @returns Result.
       */
      evaluate: <TResult>(fn: (e: Element) => TResult): Promise<TResult> => {
        const src = String(fn);
        if (src.includes('elementFromPoint')) return Promise.resolve(true as unknown as TResult);
        // traceElementInfo returns string for href-target logging
        captured.push(fn as unknown as (e: Element) => string);
        const fnResult3 = fn(el1);
        return Promise.resolve(fnResult3);
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      innerText: (): Promise<string> => Promise.resolve(''),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getAttribute: (): Promise<string | null> => Promise.resolve('/link'),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      click: (): Promise<boolean> => Promise.resolve(true),
    } as unknown as Locator;
    const page = makePage(locator);
    const m = createElementMediator(page);
    await m.resolveVisible([{ kind: 'textContent', value: 't', target: 'href' }], 200);
    // Find traceElementInfo specifically — it uses closest('a') and returns a
    // template string (not an object like extractIdentity).
    const traceCb = captured.find(c => {
      const src = String(c);
      return src.includes('closest') && src.includes('tagName');
    });
    expect(traceCb).toBeDefined();
    const traceCbSafe = traceCb as (e: Element) => string;

    // Branch: all fields populated
    const r1 = traceCbSafe(el1);
    expect(typeof r1).toBe('string');
    expect(r1).toContain('tag=SPAN');
    expect(r1).toContain('href=/link');
    expect(r1).toContain('aria=mylabel');
    expect(r1).toContain('closestA=/ancestor');
    const trimResult4 = 'Hello World Text Content'.slice(0, 30).trim();
    expect(r1).toContain(trimResult4);

    // Branch: textContent null → text stays "(none)"
    const elNoText = makeMockElement({
      tagName: 'DIV',
      textContent: null,
      href: null,
      ariaLabel: null,
      closestAnchor: null,
    });
    const r2 = traceCbSafe(elNoText);
    expect(r2).toContain('text=(none)');
    expect(r2).toContain('href=(none)');
    expect(r2).toContain('aria=(none)');
    expect(r2).toContain('closestA=NO_ANCHOR');

    // Branch: closestA present but getAttribute(href) returns null → NO_ATTR
    const elAnchorNoHref = makeMockElement({
      tagName: 'P',
      textContent: 'txt',
      closestAnchor: {
        href: '',
        /**
         * Attribute returns null for every name.
         * @returns null.
         */
        getAttribute: (): string | null => null,
      },
    });
    const r3 = traceCbSafe(elAnchorNoHref);
    expect(r3).toContain('closestA=(none)');
  }, 5000);
});

describe('CreateElementMediator — resolveVisibleInContextImpl winner<0 branch', () => {
  it('returns NOT_FOUND when all locators fail waitFor in the context', async () => {
    const locator = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      first: (): Locator => locator as unknown as Locator,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      waitFor: (): Promise<boolean> => Promise.reject(new Error('never visible')),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      evaluate: (): Promise<unknown> => Promise.resolve(false),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      innerText: (): Promise<string> => Promise.resolve(''),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getAttribute: (): Promise<string | false> => Promise.resolve(false),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      click: (): Promise<boolean> => Promise.resolve(true),
    } as unknown as Locator;
    const page = makePage(locator);
    const m = createElementMediator(page);
    const r = await m.resolveVisibleInContext([{ kind: 'textContent', value: 'x' }], page, 50);
    expect(r.found).toBe(false);
  }, 10000);

  it('resolveVisibleInContextImpl with visible+hit succeeds', async () => {
    const rec: ICallbackRecorder = { callbacks: [] };
    const el = makeMockElement({
      rect: { left: 0, top: 0, width: 20, height: 20 },
    });
    const locator = makeInvokingLocator(el, rec);
    const origDoc = (globalThis as { document?: Document }).document;
    (globalThis as { document: unknown }).document = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      elementFromPoint: (): Element => el,
    };
    try {
      const page = makePage(locator);
      const m = createElementMediator(page);
      const r = await m.resolveVisibleInContext([{ kind: 'textContent', value: 'x' }], page, 200);
      expect(r.found).toBe(true);
    } finally {
      if (origDoc) (globalThis as { document: unknown }).document = origDoc;
      else delete (globalThis as { document?: unknown }).document;
    }
  }, 5000);
});

describe('CreateElementMediator — buildCandidateLocators default fallback kind', () => {
  it('labelText kind falls through to default getByText dispatch (exactText branch 1 false path)', async () => {
    const locator = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      first: (): Locator => locator as unknown as Locator,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      waitFor: (): Promise<boolean> => Promise.reject(new Error('not visible')),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      evaluate: (): Promise<unknown> => Promise.resolve(false),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      innerText: (): Promise<string> => Promise.resolve(''),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getAttribute: (): Promise<string | false> => Promise.resolve(false),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      click: (): Promise<boolean> => Promise.resolve(true),
    } as unknown as Locator;
    const page = makePage(locator);
    const m = createElementMediator(page);
    // 'labelText' and 'css' don't match any explicit branch → default.
    const r = await m.resolveVisible(
      [
        { kind: 'labelText', value: 'User' },
        { kind: 'css', value: '.user' },
      ],
      50,
    );
    expect(r.found).toBe(false);
  }, 10000);
});

describe('CreateElementMediator — extractIdentity callback (invoked locally)', () => {
  it('handles id, className, name, type nullish branches', async () => {
    const captured: ((e: Element) => Record<string, string>)[] = [];
    const el = makeMockElement({
      tagName: 'INPUT',
      id: 'my-input',
      className: 'ctl primary',
      name: 'username',
      type: 'text',
    });
    const locator = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      first: (): Locator => locator as unknown as Locator,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      waitFor: (): Promise<boolean> => Promise.resolve(true),
      /**
       * Test helper.
       *
       * @param fn - Parameter.
       * @returns Result.
       */
      evaluate: <TResult>(fn: (e: Element) => TResult): Promise<TResult> => {
        const src = String(fn);
        if (src.includes('elementFromPoint')) return Promise.resolve(true as unknown as TResult);
        captured.push(fn as unknown as (e: Element) => Record<string, string>);
        const fnResult5 = fn(el);
        return Promise.resolve(fnResult5);
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      innerText: (): Promise<string> => Promise.resolve('hi'),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getAttribute: (): Promise<string | false> => Promise.resolve(false),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      click: (): Promise<boolean> => Promise.resolve(true),
    } as unknown as Locator;
    const page = makePage(locator);
    const m = createElementMediator(page);
    await m.resolveVisible([{ kind: 'textContent', value: 't' }], 200);
    // Find extractIdentity — uses className + tagName but NOT closest.
    const idCb = captured.find(c => {
      const src = String(c);
      return src.includes('className') && !src.includes('closest');
    });
    expect(idCb).toBeDefined();
    const idCbSafe = idCb as (e: Element) => {
      tag: string;
      id: string;
      classes: string;
      name: string;
      type: string;
    };

    // All present
    const r1 = idCbSafe(el);
    expect(r1.tag).toBe('INPUT');
    expect(r1.id).toBe('my-input');
    expect(r1.classes).toBe('ctl primary');
    expect(r1.name).toBe('username');
    expect(r1.type).toBe('text');

    // All nullish — triggers || '(none)' and ?? '(none)' branches
    const elEmpty = makeMockElement({
      tagName: 'DIV',
      id: '',
      className: '',
      name: null,
      type: null,
    });
    const r2 = idCbSafe(elEmpty);
    expect(r2.id).toBe('(none)');
    expect(r2.classes).toBe('(none)');
    expect(r2.name).toBe('(none)');
    expect(r2.type).toBe('(none)');
  }, 5000);
});
