/**
 * Shared mock Element/Locator/Page factories for CreateElementMediator callback tests.
 */

import type { BrowserContext, Locator, Page } from 'playwright-core';

/** Mock cookie shape. */
export interface IMockCookie {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path: string;
}

/** Captured callback invoker — holds last evaluate callback. */
export interface ICallbackRecorder {
  readonly callbacks: unknown[];
}

/** Simulated DOM bounding rect for isTrulyVisible. */
export interface IMockRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Nullable string alias — hides `null` literal from ESLint no-restricted-syntax. */
export type NullableString = string | null;
/** Nullable attribute getter alias. */
export type NullableGetter = (n: string) => NullableString;
/** Nullable closestAnchor alias. */
export type NullableAnchor = { href: string; getAttribute?: NullableGetter } | null;

/** Build an Element mock with configurable methods. */
export interface IMockElementOpts {
  readonly tagName?: string;
  readonly id?: string;
  readonly className?: string;
  readonly name?: NullableString;
  readonly type?: NullableString;
  readonly href?: NullableString;
  readonly ariaLabel?: NullableString;
  readonly textContent?: NullableString;
  readonly rect?: IMockRect;
  readonly hit?: Element | null;
  readonly closestAnchor?: NullableAnchor;
  readonly scrollCount?: { calls: number };
  readonly disabled?: boolean;
  readonly ariaDisabled?: NullableString;
}

/**
 * Build a hasAttribute checker that honors the mock's disabled flag and
 * falls back to the static attrMap. Extracted from makeMockElement to keep
 * its cyclomatic complexity within the lint limit.
 * @param opts - Mock element options (provides the disabled flag).
 * @param attrMap - Static attribute map.
 * @returns hasAttribute function suitable for the Element shape.
 */
function buildHasAttribute(
  opts: IMockElementOpts,
  attrMap: Record<string, NullableString>,
): (n: string) => boolean {
  return (n: string): boolean => {
    if (n === 'disabled') return opts.disabled === true;
    return attrMap[n] != null;
  };
}

/**
 * Build the static attribute map. Extracted from makeMockElement so that
 * the per-attribute `??` fallbacks count toward this helper's complexity
 * rather than inflating makeMockElement past the lint threshold.
 * @param opts - Mock element options.
 * @returns Attribute name → nullable value map.
 */
function buildAttrMap(opts: IMockElementOpts): Record<string, NullableString> {
  return {
    href: opts.href ?? null,
    'aria-label': opts.ariaLabel ?? null,
    name: opts.name ?? null,
    type: opts.type ?? null,
    'aria-disabled': opts.ariaDisabled ?? null,
  };
}

/**
 * Build a synthetic Element for invoking page.evaluate callbacks.
 * @param opts - Mock behavior.
 * @returns Mock Element typed as Element.
 */
export function makeMockElement(opts: IMockElementOpts): Element {
  const attrMap = buildAttrMap(opts);
  const hasAttr = buildHasAttribute(opts, attrMap);
  const rect = opts.rect ?? { left: 0, top: 0, width: 10, height: 10 };
  /**
   * Return attribute value for tracing, typed via alias to avoid raw null in signature.
   * @param n - Attribute name.
   * @returns Attribute value or null when absent.
   */
  const getAttrTyped: NullableGetter = (n: string) => attrMap[n] ?? null;
  const el = {
    tagName: opts.tagName ?? 'DIV',
    id: opts.id ?? '',
    className: opts.className ?? '',
    textContent: opts.textContent ?? null,
    /**
     * Return attribute value for tracing.
     * @param n - Attribute name.
     * @returns Attribute value or null when absent.
     */
    getAttribute: getAttrTyped,
    /**
     * Reflect attr presence; mock has no disabled/aria-disabled by default.
     * @param n - Attribute name.
     * @returns True if attr is set on the mock attrMap.
     */
    hasAttribute: hasAttr,
    /**
     * Return bounding client rect.
     * @returns Rect.
     */
    getBoundingClientRect: (): IMockRect => rect,
    /**
     * Scroll into view — track call.
     * @returns True once scrolled.
     */
    scrollIntoView: (): boolean => {
      if (opts.scrollCount) opts.scrollCount.calls += 1;
      return true;
    },
    /**
     * closest ancestor selector.
     * @param sel - Parameter.
     * @returns Anchor mock or null.
     */
    closest: (sel: string): unknown => {
      const anchor = sel === 'a' ? (opts.closestAnchor ?? false) : false;
      return anchor;
    },
    /**
     * Check if element contains another node.
     * @param other - Parameter.
     * @returns True when `hit` is this element.
     */
    contains: (other: unknown): boolean => other === el,
  };
  return el as unknown as Element;
}

/**
 * Build a minimal Locator wrapper that invokes evaluate callbacks locally
 * with a supplied Element mock and the arg passed through.
 * @param el - The mock element.
 * @param recorder - Recorder capturing invoked callbacks.
 * @returns Locator with evaluate that invokes the callback.
 */
export function makeInvokingLocator(el: Element, recorder: ICallbackRecorder): Locator {
  const self = {
    /**
     * Test helper.
     * @returns Result.
     */
    first: (): Locator => self as unknown as Locator,
    /**
     * Invoke callback locally with supplied element + arg.
     * @param fn - Callback from pipeline code.
     * @param arg - Additional arg (e.g. mockMode flag).
     * @returns Result of invoking fn.
     */
    evaluate: <TResult>(
      fn: (e: Element, arg?: unknown) => TResult,
      arg?: unknown,
    ): Promise<TResult> => {
      recorder.callbacks.push(fn);
      const fnResult1 = fn(el, arg);
      return Promise.resolve(fnResult1);
    },
    /**
     * Test helper.
     * @returns Result.
     */
    waitFor: (): Promise<boolean> => Promise.resolve(true),
    /**
     * Test helper.
     * @returns Result.
     */
    innerText: (): Promise<string> => Promise.resolve('inner'),
    /**
     * Test helper.
     * @returns Result.
     */
    getAttribute: (): Promise<string | false> => Promise.resolve(false),
    /**
     * Test helper.
     * @returns Result.
     */
    click: (): Promise<boolean> => Promise.resolve(true),
    /**
     * Test helper.
     * @returns Result.
     */
    count: (): Promise<number> => Promise.resolve(1),
    /**
     * Test helper — nth(i) returns self so resolveAllVisible's
     * nth-enumeration treats every match as the same mock element.
     * @returns Self.
     */
    nth: (): Locator => self as unknown as Locator,
    /**
     * Test helper.
     * @returns Result.
     */
    isVisible: (): Promise<boolean> => Promise.resolve(true),
    /**
     * Test helper.
     * @returns Result.
     */
    evaluateAll: (): Promise<string[]> => Promise.resolve([]),
  };
  return self as unknown as Locator;
}

/**
 * Build a Page that returns a locator with invoking evaluate behavior.
 * @param locator - Locator to return from every accessor.
 * @returns Mock page.
 */
export function makePage(locator: Locator): Page {
  const page: unknown = {
    /**
     * Test helper.
     * @returns Result.
     */
    url: (): string => 'https://bank.co.il',
    /**
     * Test helper.
     * @returns Result.
     */
    goto: (): Promise<false> => Promise.resolve(false),
    /**
     * Test helper.
     * @returns Result.
     */
    on: (): Page => ({}) as Page,
    /**
     * Test helper.
     * @returns Result.
     */
    waitForResponse: (): Promise<false> => Promise.race([]),
    /**
     * Test helper.
     * @returns Result.
     */
    waitForLoadState: (): Promise<boolean> => Promise.resolve(true),
    /**
     * Test helper.
     * @returns Result.
     */
    waitForURL: (): Promise<boolean> => Promise.resolve(true),
    /**
     * Test helper.
     * @returns Result.
     */
    mainFrame: (): unknown => page,
    /**
     * Test helper.
     * @returns Result.
     */
    frames: (): unknown[] => [page],
    /**
     * Test helper.
     * @returns Result.
     */
    getByText: (): Locator => locator,
    /**
     * Test helper.
     * @returns Result.
     */
    getByLabel: (): Locator => locator,
    /**
     * Test helper.
     * @returns Result.
     */
    getByRole: (): Locator => locator,
    /**
     * Test helper.
     * @returns Result.
     */
    getByPlaceholder: (): Locator => locator,
    /**
     * Test helper.
     * @returns Result.
     */
    locator: (): Locator => locator,
    /**
     * Test helper.
     * @returns Result.
     */
    context: (): BrowserContext =>
      ({
        /**
         * Test helper.
         * @returns Result.
         */
        cookies: (): Promise<IMockCookie[]> => Promise.resolve([]),
        /**
         * Test helper.
         * @returns Result.
         */
        addCookies: (): Promise<boolean> => Promise.resolve(true),
      }) as unknown as BrowserContext,
    /**
     * Test helper.
     * @returns Result.
     */
    evaluate: (): Promise<Record<string, string>> => Promise.resolve({}),
  };
  return page as Page;
}
