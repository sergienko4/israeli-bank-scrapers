/**
 * Dispatch-args construction for the ApiDirectScrape phase driver.
 * Resolves each step's urlTag (literal or producer) and assembles the
 * IDispatchArgs bundle (verb, vars, body, headers, signing) consumed by
 * dispatchStep. Split out of ApiDirectScrapeSteps.ts to keep both files
 * within the per-file LOC ceiling. Zero bank-name coupling.
 */

import type { IApiMediator, IApiQueryOpts } from '../../Mediator/Api/ApiMediator.js';
import type { WKUrlOrLiteral } from '../../Registry/WK/UrlsWK.js';
import type { IActionContext } from '../../Types/PipelineContext.js';
import type { IDispatchArgs } from './ApiDirectScrapeDispatch.js';
import type {
  ApiDirectScrapeHeadersLike,
  HeaderMap,
  IApiDirectScrapeShape,
} from './IApiDirectScrapeShape.js';

const FROZEN_EMPTY_HEADERS: HeaderMap = Object.freeze({});
const FROZEN_EMPTY_OPTS: IApiQueryOpts = Object.freeze({ extraHeaders: FROZEN_EMPTY_HEADERS });

/** Driver context — shape + bus + action context. */
export interface IDriverCtx<TAcct, TCursor> {
  readonly shape: IApiDirectScrapeShape<TAcct, TCursor>;
  readonly bus: IApiMediator;
  readonly ctx: IActionContext;
}

/** Per-account context — driver context + current account. */
export interface IAcctCtx<TAcct, TCursor> extends IDriverCtx<TAcct, TCursor> {
  readonly acct: TAcct;
}

/**
 * Resolve a ApiDirectScrapeHeadersLike to a concrete HeaderMap.
 * @param ctx - Action context passed into dynamic producers.
 * @param extra - Static map, function, or absent.
 * @returns Concrete header map (frozen empty when absent).
 */
function resolveHeaders(ctx: IActionContext, extra?: ApiDirectScrapeHeadersLike): HeaderMap {
  if (!extra) return FROZEN_EMPTY_HEADERS;
  if (typeof extra === 'function') return extra(ctx);
  return extra;
}

/**
 * Build IApiQueryOpts from optional extraHeaders. Returns the frozen
 * empty sentinel when no headers are supplied so consumers can pin
 * `===` checks against it.
 * @param ctx - Action context for dynamic producers.
 * @param extra - Static map, function, or absent.
 * @returns Opts value.
 */
function toOpts(ctx: IActionContext, extra?: ApiDirectScrapeHeadersLike): IApiQueryOpts {
  const headers = resolveHeaders(ctx, extra);
  if (Object.keys(headers).length === 0) return FROZEN_EMPTY_OPTS;
  return { extraHeaders: headers };
}

/**
 * Pull shape-level signer + secrets onto a dispatch-args slice.
 * @param shape - Bank shape literal.
 * @returns Slice with signer + secrets fields.
 */
function pickShapeSigning<TAcct, TCursor>(
  shape: IApiDirectScrapeShape<TAcct, TCursor>,
): Pick<IDispatchArgs, 'signer' | 'secrets'> {
  return { signer: shape.signer ?? false, secrets: shape.secrets };
}

/**
 * Resolve a customer-step urlTag (literal or producer).
 * @param d - Driver context.
 * @returns WK URL tag or `false` when GraphQL.
 */
function resolveCustomerUrlTag<TAcct, TCursor>(
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
 * Build the customer-step dispatch args bundle.
 * @param d - Driver context.
 * @returns Dispatch args ready for {@link dispatchStep}.
 */
export function buildCustomerDispatchArgs<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
): IDispatchArgs {
  return {
    bus: d.bus,
    ctx: d.ctx,
    queryTag: 'customer',
    urlTag: resolveCustomerUrlTag(d),
    method: d.shape.customer.method ?? 'POST',
    vars: d.shape.customer.buildVars(d.ctx),
    bodyTemplate: d.shape.customer.bodyTemplate ?? false,
    ...pickShapeSigning(d.shape),
    opts: toOpts(d.ctx, d.shape.customer.extraHeaders),
  };
}

/**
 * Resolve a balance-step urlTag (literal or producer).
 * @param a - Per-account context.
 * @returns WK URL tag or `false` when GraphQL.
 */
function resolveBalanceUrlTag<TAcct, TCursor>(a: IAcctCtx<TAcct, TCursor>): WKUrlOrLiteral | false {
  const spec = a.shape.balance.urlTag;
  if (spec === undefined) return false;
  if (typeof spec === 'function') return spec(a.acct);
  return spec;
}

/**
 * Build the balance-step dispatch args bundle.
 * @param a - Per-account context.
 * @returns Dispatch args ready for {@link dispatchStep}.
 */
export function buildBalanceDispatchArgs<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
): IDispatchArgs {
  return {
    bus: a.bus,
    ctx: a.ctx,
    queryTag: 'balance',
    urlTag: resolveBalanceUrlTag(a),
    method: a.shape.balance.method ?? 'POST',
    vars: a.shape.balance.buildVars(a.acct, a.ctx),
    bodyTemplate: a.shape.balance.bodyTemplate ?? false,
    ...pickShapeSigning(a.shape),
    opts: toOpts(a.ctx, a.shape.balance.extraHeaders),
  };
}

/**
 * Resolve a transactions-step urlTag (literal or producer).
 * @param a - Per-account context.
 * @param cursor - Cursor passed into the producer (when dynamic).
 * @returns WK URL tag or `false` when GraphQL.
 */
function resolveTxnsUrlTag<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
  cursor: TCursor | false,
): WKUrlOrLiteral | false {
  const spec = a.shape.transactions.urlTag;
  if (spec === undefined) return false;
  if (typeof spec === 'function') return spec(a.acct, cursor, a.ctx);
  return spec;
}

/**
 * Build the transactions-step dispatch args bundle.
 * @param a - Per-account context.
 * @param cursor - Cursor for this round (or false on first call).
 * @returns Dispatch args ready for {@link dispatchStep}.
 */
export function buildTxnsDispatchArgs<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
  cursor: TCursor | false,
): IDispatchArgs {
  const t = a.shape.transactions;
  const vars = t.buildVars(a.acct, cursor, a.ctx);
  const head = { bus: a.bus, ctx: a.ctx, queryTag: 'transactions' as const, vars };
  const urlTag = resolveTxnsUrlTag(a, cursor);
  const bodyTemplate = t.bodyTemplate ?? false;
  const method = t.method ?? 'POST';
  const opts = toOpts(a.ctx, t.extraHeaders);
  return { ...head, urlTag, method, bodyTemplate, ...pickShapeSigning(a.shape), opts };
}
