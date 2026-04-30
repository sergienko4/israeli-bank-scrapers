/**
 * Shared mock Locator/Page + scripts for CreateElementMediatorExtra split test files.
 */

import type { BrowserContext, Locator, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../../../Scrapers/Base/Config/LoginConfigTypes.js';

/** Nullable attribute alias — hides `null` literal from ESLint no-restricted-syntax. */
export type NullableAttr = string | null;

/** Local test error for rejecting with a non-Error class (PII-safe). */
export class TestError extends Error {
  /**
   * Test helper.
   * @param message - Message text.
   */
  constructor(message: string) {
    super(message);
    this.name = 'TestError';
  }
}

/** Behaviour controls for a rich mock locator. */
export interface ILocatorScript {
  readonly visible: boolean;
  readonly innerText?: string;
  readonly attr?: string | null;
  readonly hitTest?: boolean;
  readonly clickThrows?: boolean;
}

/** Scripted evaluate() return union. */
type EvaluateResult = boolean | string | Record<string, string>;

/**
 * Hit-test branch — shared between elementFromPoint and getBoundingClientRect sources.
 * @param script - Behaviour script.
 * @returns Scripted hit-test result (defaults true).
 */
function resolveHitTest(script: ILocatorScript): boolean {
  return script.hitTest ?? true;
}

/**
 * Dispatch the source-string to a specific branch of the evaluate mock.
 * Keeps each branch trivial so cognitive complexity stays <15.
 * @param src - Stringified evaluate callback.
 * @param script - Behaviour script.
 * @returns Scripted result.
 */
function dispatchEvaluateSource(src: string, script: ILocatorScript): EvaluateResult {
  if (src.includes('elementFromPoint') || src.includes('getBoundingClientRect')) {
    return resolveHitTest(script);
  }
  if (src.includes('className')) {
    return {
      tag: 'DIV',
      id: '(none)',
      classes: '(none)',
      name: '(none)',
      type: '(none)',
    };
  }
  if (src.includes('tagName')) {
    return 'tag=DIV text= href=(none) aria=(none) closestA=(none)';
  }
  if (src.includes('closest')) return script.attr ?? '';
  return '';
}

/**
 * Build a Locator that races as "visible" (or not) and records click attempts.
 * @param script - Behaviour script.
 * @returns Mock locator.
 */
export function makeRichLocator(script: ILocatorScript): Locator {
  const self = {
    /**
     * first.
     * @returns Self.
     */
    first: (): Locator => self as unknown as Locator,
    /**
     * waitFor — resolves if visible, rejects otherwise.
     * @returns Scripted.
     */
    waitFor: (): Promise<boolean> => {
      if (script.visible) return Promise.resolve(true);
      return Promise.reject(new Error('not visible'));
    },
    /**
     * evaluate — inspects function source to branch between hit-test,
     * traceElementInfo (returns string), and walkUpToAnchorHref (returns string).
     * @param fn - Evaluated function.
     * @returns Scripted.
     */
    evaluate: (fn: unknown): Promise<boolean | string | Record<string, string>> => {
      const src = String(fn);
      const dispatchResult = dispatchEvaluateSource(src, script);
      return Promise.resolve(dispatchResult);
    },
    /**
     * getAttribute.
     * @returns Scripted attr.
     */
    getAttribute: (): Promise<NullableAttr> => {
      const val: NullableAttr = script.attr ?? null;
      return Promise.resolve(val);
    },
    /**
     * innerText.
     * @returns Scripted.
     */
    innerText: (): Promise<string> => Promise.resolve(script.innerText ?? ''),
    /**
     * click.
     * @returns Resolves or rejects.
     */
    click: (): Promise<boolean> => {
      if (script.clickThrows) return Promise.reject(new Error('click fail'));
      return Promise.resolve(true);
    },
    /**
     * count.
     * @returns 1.
     */
    count: (): Promise<number> => Promise.resolve(1),
    /**
     * isVisible.
     * @returns Scripted.
     */
    isVisible: (): Promise<boolean> => Promise.resolve(script.visible),
    /**
     * evaluateAll — returns empty array (for collectAllHrefs).
     * @returns Empty.
     */
    evaluateAll: (): Promise<string[]> => Promise.resolve([]),
  };
  return self as unknown as Locator;
}

/** Page-building script. */
export interface IRichPageScript {
  readonly url?: string;
  readonly locator: Locator;
}

/**
 * Build a rich Page that returns the supplied locator from multiple accessor APIs.
 * @param script - Behaviour.
 * @returns Mock page.
 */
export function makeRichPage(script: IRichPageScript): Page {
  const url = script.url ?? 'https://bank.co.il';
  const page: unknown = {
    /**
     * url.
     * @returns URL.
     */
    url: (): string => url,
    /**
     * goto.
     * @returns Resolves.
     */
    goto: (): Promise<false> => Promise.resolve(false),
    /**
     * on.
     * @returns Self.
     */
    on: (): Page => ({}) as Page,
    /**
     * waitForResponse.
     * @returns Never-resolving.
     */
    waitForResponse: (): Promise<false> => Promise.race([]),
    /**
     * waitForLoadState.
     * @returns Resolves.
     */
    waitForLoadState: (): Promise<boolean> => Promise.resolve(true),
    /**
     * waitForURL.
     * @returns Resolves.
     */
    waitForURL: (): Promise<boolean> => Promise.resolve(true),
    /**
     * mainFrame.
     * @returns Self.
     */
    mainFrame: (): unknown => page,
    /**
     * frames.
     * @returns Array with self.
     */
    frames: (): unknown[] => [page],
    /**
     * getByText.
     * @returns Scripted locator.
     */
    getByText: (): Locator => script.locator,
    /**
     * getByLabel.
     * @returns Scripted locator.
     */
    getByLabel: (): Locator => script.locator,
    /**
     * getByRole.
     * @returns Scripted locator.
     */
    getByRole: (): Locator => script.locator,
    /**
     * getByPlaceholder.
     * @returns Scripted locator.
     */
    getByPlaceholder: (): Locator => script.locator,
    /**
     * locator.
     * @returns Scripted locator.
     */
    locator: (): Locator => script.locator,
    /**
     * context.
     * @returns Minimal BrowserContext stub.
     */
    context: (): BrowserContext =>
      ({
        /**
         * cookies.
         * @returns Empty.
         */
        cookies: (): Promise<unknown[]> => Promise.resolve([]),
        /**
         * addCookies.
         * @returns Resolves.
         */
        addCookies: (): Promise<boolean> => Promise.resolve(true),
      }) as unknown as BrowserContext,
    /**
     * evaluate.
     * @returns Empty object.
     */
    evaluate: (): Promise<Record<string, string>> => Promise.resolve({}),
  };
  return page as Page;
}

/** All the candidate kinds CreateElementMediator must handle. */
export const CANDIDATE_KINDS: readonly { kind: SelectorCandidate['kind']; value: string }[] = [
  { kind: 'textContent', value: 'Login' },
  { kind: 'clickableText', value: 'Click Me' },
  { kind: 'ariaLabel', value: 'Submit' },
  { kind: 'placeholder', value: 'Username' },
  { kind: 'xpath', value: '//button' },
  { kind: 'name', value: 'user' },
  { kind: 'regex', value: 'pattern' },
  { kind: 'exactText', value: 'Exact' },
];
