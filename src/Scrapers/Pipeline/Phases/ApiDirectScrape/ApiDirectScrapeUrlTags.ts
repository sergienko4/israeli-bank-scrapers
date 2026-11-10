/**
 * urlTag resolution for the ApiDirectScrape phase driver.
 *
 * <p>A step declares its urlTag as a WK tag or as a producer, and a producer
 * may learn the action context, the account, or the page cursor. Resolving
 * them here keeps the dispatch-args builder reading as a field list. Split
 * out of ApiDirectScrapeDispatchArgs.ts to keep both files under the
 * per-file LOC ceiling. Zero bank-name coupling.
 */

import type { WKUrlOrLiteral } from '../../Registry/WK/UrlsWK.js';
import type { IAcctCtx, IDriverCtx } from './ApiDirectScrapeTypes.js';

/**
 * Resolve a customer-step urlTag (literal or producer).
 * @param d - Driver context.
 * @returns WK URL tag or `false` when GraphQL.
 */
export function resolveCustomerUrlTag<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
): WKUrlOrLiteral | false {
  const spec = d.shape.customer.urlTag;
  if (spec === undefined) return false;
  if (typeof spec === 'function') return spec(d.ctx);
  return spec;
}

/**
 * Resolve the optional customer secondary-identity urlTag (a second GET
 * whose body augments `extractAccounts`). Mirrors
 * {@link resolveCustomerUrlTag}, but `false` here means "no secondary
 * fetch declared" — there is no GraphQL secondary variant.
 * @param d - Driver context.
 * @returns WK URL tag, or `false` when the shape declares none.
 */
export function resolveSecondaryUrlTag<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
): WKUrlOrLiteral | false {
  const spec = d.shape.customer.secondaryUrlTag;
  if (spec === undefined) return false;
  if (typeof spec === 'function') return spec(d.ctx);
  return spec;
}

/**
 * Resolve a balance-step urlTag (literal or producer).
 * @param a - Per-account context.
 * @returns WK URL tag or `false` when GraphQL.
 */
export function resolveBalanceUrlTag<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
): WKUrlOrLiteral | false {
  const spec = a.shape.balance.urlTag;
  if (spec === undefined) return false;
  if (typeof spec === 'function') return spec(a.acct);
  return spec;
}

/**
 * Resolve a transactions-step urlTag (literal or producer).
 * @param a - Per-account context.
 * @param cursor - Cursor passed into the producer (when dynamic).
 * @returns WK URL tag or `false` when GraphQL.
 */
export function resolveTxnsUrlTag<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
  cursor: TCursor | false,
): WKUrlOrLiteral | false {
  const spec = a.shape.transactions.urlTag;
  if (spec === undefined) return false;
  if (typeof spec === 'function') return spec(a.acct, cursor, a.ctx);
  return spec;
}
