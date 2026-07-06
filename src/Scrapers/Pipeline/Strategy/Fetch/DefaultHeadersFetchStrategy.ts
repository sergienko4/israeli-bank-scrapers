/**
 * Default-headers fetch-strategy decorator.
 *
 * Wraps any {@link IFetchStrategy} to merge a fixed default-header bag
 * UNDER every call's per-call `extraHeaders`. A browser hard-model bank
 * uses this to carry its SPA's own content-negotiation headers (Accept,
 * X-Requested-With, Content-Type) + Origin / Referer / X-Site-Id —
 * discovered once at BIND from the bank's captured transactions endpoint —
 * on every customer / balance / transactions call, without each shape
 * re-declaring them. Replicates the generic AUTH-DISCOVERY green path.
 *
 * Precedence: per-call `extraHeaders` (and the mediator's rawAuth
 * Authorization, already merged into `opts` upstream) always win over the
 * defaults. An empty bag is a transparent pass-through — {@link
 * withDefaultHeaders} returns the inner strategy unchanged — so wrapping a
 * bank that doesn't opt in is byte-identical to not wrapping (OCP).
 */

import type { Procedure } from '../../Types/Procedure.js';
import type { IFetchOpts, IFetchStrategy, PostData } from './FetchStrategy.js';

/** Immutable default-header bag installed under every call. */
type DefaultHeaders = Readonly<Record<string, string>>;

/**
 * Merge the default bag UNDER a call's per-call headers.
 * @param defaults - Default headers (the floor).
 * @param opts - Per-call fetch options.
 * @returns Opts whose extraHeaders layer per-call over defaults.
 */
function mergeUnder(defaults: DefaultHeaders, opts: IFetchOpts): IFetchOpts {
  return { ...opts, extraHeaders: { ...defaults, ...opts.extraHeaders } };
}

/** IFetchStrategy decorator injecting a fixed default-header bag. */
class DefaultHeadersFetchStrategy implements IFetchStrategy {
  private readonly _inner: IFetchStrategy;
  private readonly _defaults: DefaultHeaders;

  /**
   * Store the wrapped strategy and the default-header bag.
   * @param inner - Wrapped concrete fetch strategy.
   * @param defaults - Default headers merged under every call.
   */
  constructor(inner: IFetchStrategy, defaults: DefaultHeaders) {
    this._inner = inner;
    this._defaults = defaults;
  }

  /**
   * POST with the default bag merged under per-call headers.
   * @param url - Target URL.
   * @param data - POST body.
   * @param opts - Per-call fetch options.
   * @returns Wrapped strategy's Procedure result.
   */
  public fetchPost<T>(url: string, data: PostData, opts: IFetchOpts): Promise<Procedure<T>> {
    const merged = mergeUnder(this._defaults, opts);
    return this._inner.fetchPost<T>(url, data, merged);
  }

  /**
   * GET with the default bag merged under per-call headers.
   * @param url - Target URL.
   * @param opts - Per-call fetch options.
   * @returns Wrapped strategy's Procedure result.
   */
  public fetchGet<T>(url: string, opts: IFetchOpts): Promise<Procedure<T>> {
    const merged = mergeUnder(this._defaults, opts);
    return this._inner.fetchGet<T>(url, merged);
  }
}

/**
 * Factory: wrap a fetch strategy with a default-header bag. Returns the
 * inner strategy UNCHANGED when the bag is empty (zero-overhead pass-
 * through for banks that don't opt in).
 * @param inner - Concrete strategy to wrap.
 * @param defaults - Default headers (empty ⇒ no wrap).
 * @returns Decorated (or original) strategy.
 */
function withDefaultHeaders(inner: IFetchStrategy, defaults: DefaultHeaders): IFetchStrategy {
  if (Object.keys(defaults).length === 0) return inner;
  return Reflect.construct(DefaultHeadersFetchStrategy, [inner, defaults]);
}

export default withDefaultHeaders;
export type { DefaultHeaders };
export { DefaultHeadersFetchStrategy, withDefaultHeaders };
