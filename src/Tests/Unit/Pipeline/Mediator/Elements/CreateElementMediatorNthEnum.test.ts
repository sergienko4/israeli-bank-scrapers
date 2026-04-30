/**
 * Verification test for the nth-enumeration fix in `resolveAllVisible`.
 *
 * Context: real Beinleumi dashboard renders TWO buttons with the same
 * `aria-label="תנועות בחשבון"` — legacy `pm.mataf.portal.FibiMenu...
 * .PrivateAccountFlow` and modern `pm.q077`. The pre-fix resolver used
 * `.first()` semantics so only the legacy button ever surfaced. The fix:
 * enumerate `.nth(0..MAX_NTH_PER_LOCATOR-1)` per base locator, then dedup
 * by DOM identity in `extractWinnerSequence`.
 *
 * This test mirrors the user-provided HTML structure (legacy `pm.mataf.*`
 * + modern `pm.q077`, both with `aria-label="תנועות בחשבון"`) and asserts
 * the resolver surfaces BOTH as distinct candidates.
 */

import type { Locator, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../../../Scrapers/Base/Config/LoginConfigTypes.js';
import createElementMediator from '../../../../../Scrapers/Pipeline/Mediator/Elements/CreateElementMediator.js';

/** Hebrew aria-label shared by the legacy + modern transactions buttons. */
const TXN_ARIA = 'תנועות בחשבון';
/** Real Beinleumi legacy nav button id. */
const LEGACY_ID = 'pm.mataf.portal.FibiMenu.Onln.TransBalances.PrivateAccountFlow';
/** Real Beinleumi modern nav button id. */
const MODERN_ID = 'pm.q077';

/** Identity bundle returned by the in-page evaluate stub. */
interface IFakeIdentity {
  readonly tag: string;
  readonly id: string;
  readonly classes: string;
  readonly name: string;
  readonly type: string;
  readonly ariaLabel: string;
  readonly title: string;
  readonly href: string;
}

/** Bounding-rect shape used by `getBoundingClientRect` stubs. */
interface IFakeRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Attribute lookup shape used by both getAttribute + hasAttribute. */
type FakeAttrMap = Record<string, string>;

/**
 * Build a synthetic identity record matching what `extractIdentity` would
 * pull off a real `<button id="..." aria-label="...">` element.
 * @param id - The button's `id` attribute.
 * @returns Identity bundle.
 */
function makeButtonIdentity(id: string): IFakeIdentity {
  return {
    tag: 'BUTTON',
    id,
    classes: 'personal-menu-link',
    name: '(none)',
    type: 'button',
    ariaLabel: TXN_ARIA,
    title: '(none)',
    href: '(none)',
  };
}

/**
 * Build the static attribute map shared by `getAttribute` and `hasAttribute`.
 * @param identity - Identity bundle whose attrs to expose.
 * @returns Name → value map (only set entries present).
 */
function buildAttrMap(identity: IFakeIdentity): FakeAttrMap {
  return {
    id: identity.id,
    'aria-label': identity.ariaLabel,
    type: identity.type,
  };
}

/**
 * Build a synthetic Element that satisfies the few methods the resolver
 * touches: `getAttribute`, `hasAttribute`, `getBoundingClientRect`,
 * `scrollIntoView`, `contains`. No real DOM behind it.
 * @param identity - Identity bundle attached to this element.
 * @returns Element-shaped object cast to Element.
 */
function makeFakeElement(identity: IFakeIdentity): Element {
  const attrMap = buildAttrMap(identity);
  const rect: IFakeRect = { left: 10, top: 10, width: 100, height: 30 };
  /**
   * Read an attribute by name from the static map.
   * @param n - Attribute name.
   * @returns Value when present, empty string otherwise.
   */
  const getAttribute = (n: string): string => attrMap[n] ?? '';
  /**
   * Disabled flag is hard-coded false; everything else is "present" iff the
   * static map has an entry for it.
   * @param n - Attribute name.
   * @returns True iff present.
   */
  const hasAttribute = (n: string): boolean => {
    if (n === 'disabled') return false;
    return n in attrMap;
  };
  /**
   * Bounding-rect accessor.
   * @returns Static rect.
   */
  const getBoundingClientRect = (): IFakeRect => rect;
  /**
   * Scroll stub — no-op.
   * @returns True.
   */
  const scrollIntoView = (): true => true;
  /**
   * Element-containment stub for the hit-test path.
   * @param other - Other element or false.
   * @returns True only when `other` is the `false` sentinel.
   */
  const contains = (other: Element | false): boolean => other === false;
  return {
    id: identity.id,
    tagName: identity.tag,
    className: identity.classes,
    getAttribute,
    hasAttribute,
    getBoundingClientRect,
    scrollIntoView,
    contains,
  } as unknown as Element;
}

/**
 * Build a single-element mock Locator that returns a fixed identity from
 * `evaluate(extractFn)`. Only the methods touched by the resolver pipeline
 * are stubbed; everything else returns sentinel values.
 * @param identity - Identity to return from `evaluate`.
 * @returns Mock Locator typed as Playwright Locator.
 */
function makeNthLocator(identity: IFakeIdentity): Locator {
  const element = makeFakeElement(identity);
  const attrMap = buildAttrMap(identity);
  const self: unknown = {
    /**
     * Visibility check stub.
     * @returns Resolves true (visible).
     */
    waitFor: (): Promise<true> => Promise.resolve(true),
    /**
     * Attached-state stub.
     * @returns Resolves true (still attached).
     */
    isVisible: (): Promise<true> => Promise.resolve(true),
    /**
     * Run the supplied extractor against our synthetic element.
     * @param fn - Extractor function (e.g. `extractIdentity`).
     * @param arg - Optional second arg passed by some evaluators.
     * @returns Whatever `fn(element)` returns.
     */
    evaluate: <T>(fn: (el: Element, arg?: unknown) => T, arg?: unknown): Promise<T> => {
      const result = fn(element, arg);
      return Promise.resolve(result);
    },
    /**
     * Visible-text snapshot stub.
     * @returns The aria-label as the human-visible text.
     */
    innerText: (): Promise<string> => Promise.resolve(TXN_ARIA),
    /**
     * Async attribute reader (matches Playwright's locator.getAttribute).
     * @param n - Attribute name.
     * @returns Resolves to the value, or false when absent.
     */
    getAttribute: (n: string): Promise<string | false> => Promise.resolve(attrMap[n] ?? false),
    /**
     * Locator chaining stub.
     * @returns Self.
     */
    first: (): Locator => self as Locator,
  };
  return self as Locator;
}

/**
 * Build the multi-match base locator that mirrors `<button>×2` matching
 * `aria-label="תנועות בחשבון"`. `count() = 2`, `nth(0)` → legacy,
 * `nth(1)` → modern. Other indices return an empty locator.
 * @returns Mock base locator.
 */
function makeTxnAriaBaseLocator(): Locator {
  const legacyIdentity = makeButtonIdentity(LEGACY_ID);
  const modernIdentity = makeButtonIdentity(MODERN_ID);
  const noneIdentity = makeButtonIdentity('(none)');
  const legacyLoc = makeNthLocator(legacyIdentity);
  const modernLoc = makeNthLocator(modernIdentity);
  const noneLoc = makeNthLocator(noneIdentity);
  /**
   * Map nth index to the corresponding mock locator.
   * @param i - Zero-based nth index.
   * @returns Legacy at 0, modern at 1, none-locator at any other index.
   */
  const pickByIndex = (i: number): Locator => {
    if (i === 0) return legacyLoc;
    if (i === 1) return modernLoc;
    return noneLoc;
  };
  return {
    /**
     * Match count.
     * @returns 2 — both buttons match the aria-label.
     */
    count: (): Promise<number> => Promise.resolve(2),
    nth: pickByIndex,
    /**
     * First-match shortcut.
     * @returns nth(0) — legacy.
     */
    first: (): Locator => legacyLoc,
  } as unknown as Locator;
}

/**
 * Empty locator with `count=0` for accessor stubs that should not match
 * anything (every Page accessor except the txn aria-label one).
 * @returns Mock empty locator.
 */
function makeEmptyLocator(): Locator {
  const noneIdentity = makeButtonIdentity('(none)');
  const noneLoc = makeNthLocator(noneIdentity);
  return {
    /**
     * Match count.
     * @returns 0 — no matches.
     */
    count: (): Promise<number> => Promise.resolve(0),
    /**
     * Nth-locator factory.
     * @returns Empty locator.
     */
    nth: (): Locator => noneLoc,
    /**
     * First-match shortcut.
     * @returns Empty locator.
     */
    first: (): Locator => noneLoc,
  } as unknown as Locator;
}

/**
 * Build a Page mock whose `getByRole('button', {name: TXN_ARIA, ...})`
 * returns the multi-match locator. Other accessors return empty locators.
 * @returns Mock Page.
 */
function makeMockPage(): Page {
  const txnBase = makeTxnAriaBaseLocator();
  const empty = makeEmptyLocator();
  /** Bundled per-role accessor for getByRole. */
  interface IRoleOpts {
    readonly name?: string;
  }
  /**
   * Return the multi-match locator only for our txn aria-label, else empty.
   * @param _role - Role name (ignored).
   * @param opts - Locator options carrying optional name match.
   * @returns Multi-match for txn role+name; empty locator otherwise.
   */
  const getByRole = (_role: unknown, opts?: IRoleOpts): Locator => {
    if (opts?.name === TXN_ARIA) return txnBase;
    return empty;
  };
  return {
    /**
     * No iframes in this fixture.
     * @returns Empty array.
     */
    frames: (): Page[] => [],
    /**
     * NetworkDiscovery wires `request`/`response` listeners — return self.
     * @returns Self.
     */
    on: (): Page => makeMockPage(),
    /**
     * Navigation stub — never invoked.
     * @returns Resolves false.
     */
    goto: (): Promise<false> => Promise.resolve(false),
    /**
     * Pending-forever waitForResponse — not awaited in this test.
     * @returns Never-resolving promise.
     */
    waitForResponse: (): Promise<false> => Promise.race([]),
    getByRole,
    /**
     * Form-input label match — empty.
     * @returns Empty locator.
     */
    getByLabel: (): Locator => empty,
    /**
     * Placeholder accessor — empty.
     * @returns Empty locator.
     */
    getByPlaceholder: (): Locator => empty,
    /**
     * Text accessor — empty.
     * @returns Empty locator.
     */
    getByText: (): Locator => empty,
    /**
     * Generic CSS/xpath accessor — empty.
     * @returns Empty locator.
     */
    locator: (): Locator => empty,
    /**
     * Page is its own main frame.
     * @returns Fresh mock page.
     */
    mainFrame: (): Page => makeMockPage(),
    /**
     * Mock dashboard URL.
     * @returns String URL.
     */
    url: (): string => 'https://online.fibi.co.il/dashboard',
  } as unknown as Page;
}

/**
 * Stub `globalThis.document.elementFromPoint` so `isTrulyVisible`'s hit
 * test passes for the synthetic elements.
 * @returns The original document so the caller can restore it after.
 */
function stubElementFromPoint(): Document | false {
  const original = (globalThis as { document?: Document }).document ?? false;
  (globalThis as { document: unknown }).document = {
    /**
     * Hit-test stub — returns a truthy element so `isTrulyVisible` accepts.
     * @returns Empty Element-shaped object.
     */
    elementFromPoint: (): Element => ({}) as Element,
  };
  return original;
}

/**
 * Restore the original document after the test scope exits.
 * @param original - Document captured by `stubElementFromPoint`.
 * @returns True after restoration.
 */
function restoreDocument(original: Document | false): true {
  if (original) (globalThis as { document: unknown }).document = original;
  else delete (globalThis as { document?: unknown }).document;
  return true;
}

describe('resolveAllVisible — nth-enumeration verification', () => {
  it('surfaces BOTH pm.mataf and pm.q077 as distinct candidates from a single aria-label race', async () => {
    const original = stubElementFromPoint();
    try {
      const page = makeMockPage();
      const m = createElementMediator(page);
      const txnCandidate: SelectorCandidate = { kind: 'ariaLabel', value: TXN_ARIA };
      const winners = await m.resolveAllVisible([txnCandidate], 1000, 5);
      const winnerIds = winners.map((w): string => (w.identity ? w.identity.id : '(none)'));
      const realIds = winnerIds.filter((id): boolean => id !== '(none)');
      const distinctIds = new Set(realIds);
      expect(realIds).toContain(LEGACY_ID);
      expect(realIds).toContain(MODERN_ID);
      expect(distinctIds.size).toBeGreaterThanOrEqual(2);
    } finally {
      restoreDocument(original);
    }
  });

  it('returns exactly 2 distinct identities when the locator count is 2', async () => {
    const original = stubElementFromPoint();
    try {
      const page = makeMockPage();
      const m = createElementMediator(page);
      const txnCandidate: SelectorCandidate = { kind: 'ariaLabel', value: TXN_ARIA };
      const winners = await m.resolveAllVisible([txnCandidate], 1000, 5);
      const winnerIds = winners.map((w): string => (w.identity ? w.identity.id : '(none)'));
      const realIds = winnerIds.filter((id): boolean => id !== '(none)');
      const distinctIds = new Set(realIds);
      expect(distinctIds.size).toBe(2);
    } finally {
      restoreDocument(original);
    }
  });
});
