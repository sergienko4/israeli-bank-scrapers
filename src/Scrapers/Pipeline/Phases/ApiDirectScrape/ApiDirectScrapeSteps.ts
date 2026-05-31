/**
 * Per-step helpers for the ApiDirectScrape phase driver.
 * Consumes dispatchStep + scope helpers from ApiDirectScrapeDispatch.
 * Zero bank-name coupling.
 */

import type { IApiMediator, IApiQueryOpts } from '../../Mediator/Api/ApiMediator.js';
import type { WKUrlGroup } from '../../Registry/WK/UrlsWK.js';
import type { IPage } from '../../Strategy/Fetch/Pagination.js';
import type { Brand } from '../../Types/Brand.js';
import type { IActionContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';
import { dispatchStep, type IDispatchArgs } from './ApiDirectScrapeDispatch.js';
import type {
  ApiDirectScrapeHeadersLike,
  HeaderMap,
  IApiDirectScrapeShape,
} from './IApiDirectScrapeShape.js';

/** Stop signal — branded so Rule #15 accepts the boolean return. */
type ShouldStop = Brand<boolean, 'GenericHeadlessShouldStop'>;

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
function resolveCustomerUrlTag<TAcct, TCursor>(d: IDriverCtx<TAcct, TCursor>): WKUrlGroup | false {
  const spec = d.shape.customer.urlTag;
  if (spec === undefined) return false;
  if (typeof spec === 'function') return spec(d.ctx);
  return spec;
}

/**
 * Build the customer-step dispatch args bundle.
 * @param d - Driver context.
 * @returns Dispatch args ready for {@link dispatchStep}.
 */
function buildCustomerDispatchArgs<TAcct, TCursor>(d: IDriverCtx<TAcct, TCursor>): IDispatchArgs {
  return {
    bus: d.bus,
    ctx: d.ctx,
    queryTag: 'customer',
    urlTag: resolveCustomerUrlTag(d),
    vars: d.shape.customer.buildVars(d.ctx),
    bodyTemplate: d.shape.customer.bodyTemplate ?? false,
    ...pickShapeSigning(d.shape),
    opts: toOpts(d.ctx, d.shape.customer.extraHeaders),
  };
}

/** Empty body passed to `extractAccounts` when customer skips the fetch. */
const EMPTY_CUSTOMER_BODY = Object.freeze({});

/**
 * Fetch customer tree and extract the flat account list. Honours
 * `customer.skipFetch === true` by bypassing the network call —
 * `extractAccounts` runs against an empty body + session-context.
 * @param d - Driver context.
 * @returns Account refs procedure.
 */
export async function fetchAccounts<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
): Promise<Procedure<readonly TAcct[]>> {
  const sessionContext = d.bus.getSessionContext();
  if (d.shape.customer.skipFetch === true) {
    const accts = d.shape.customer.extractAccounts({ body: EMPTY_CUSTOMER_BODY, sessionContext });
    return succeed(accts);
  }
  const dispatchArgs = buildCustomerDispatchArgs(d);
  const resp = await dispatchStep(dispatchArgs);
  if (!isOk(resp)) return resp;
  const accts = d.shape.customer.extractAccounts({ body: resp.value, sessionContext });
  return succeed(accts);
}

/**
 * Resolve a balance-step urlTag (literal or producer).
 * @param a - Per-account context.
 * @returns WK URL tag or `false` when GraphQL.
 */
function resolveBalanceUrlTag<TAcct, TCursor>(a: IAcctCtx<TAcct, TCursor>): WKUrlGroup | false {
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
function buildBalanceDispatchArgs<TAcct, TCursor>(a: IAcctCtx<TAcct, TCursor>): IDispatchArgs {
  return {
    bus: a.bus,
    ctx: a.ctx,
    queryTag: 'balance',
    urlTag: resolveBalanceUrlTag(a),
    vars: a.shape.balance.buildVars(a.acct),
    bodyTemplate: a.shape.balance.bodyTemplate ?? false,
    ...pickShapeSigning(a.shape),
    opts: toOpts(a.ctx, a.shape.balance.extraHeaders),
  };
}

/**
 * Fetch one account's balance, honouring fallbackOnFail when set.
 * @param a - Per-account context.
 * @returns Balance procedure.
 */
export async function fetchBalance<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
): Promise<Procedure<number>> {
  const dispatchArgs = buildBalanceDispatchArgs(a);
  const resp = await dispatchStep(dispatchArgs);
  if (isOk(resp)) {
    const value = a.shape.balance.extract(resp.value);
    return succeed(value);
  }
  const fb = a.shape.balance.fallbackOnFail;
  if (fb === undefined) return resp;
  return succeed(fb);
}

/** Page fetcher signature consumed by fetchPaginated. */
type PageFetcher<TCursor> = (cursor: TCursor | false) => Promise<Procedure<IPage<object, TCursor>>>;

/**
 * Resolve a transactions-step urlTag (literal or producer).
 * @param a - Per-account context.
 * @param cursor - Cursor passed into the producer (when dynamic).
 * @returns WK URL tag or `false` when GraphQL.
 */
function resolveTxnsUrlTag<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
  cursor: TCursor | false,
): WKUrlGroup | false {
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
function buildTxnsDispatchArgs<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
  cursor: TCursor | false,
): IDispatchArgs {
  const t = a.shape.transactions;
  const vars = t.buildVars(a.acct, cursor, a.ctx);
  const head = { bus: a.bus, ctx: a.ctx, queryTag: 'transactions' as const, vars };
  const urlTag = resolveTxnsUrlTag(a, cursor);
  const bodyTemplate = t.bodyTemplate ?? false;
  const opts = toOpts(a.ctx, t.extraHeaders);
  return { ...head, urlTag, bodyTemplate, ...pickShapeSigning(a.shape), opts };
}

/**
 * Run one paginated fetch + extract round for a given cursor.
 * @param a - Per-account context.
 * @param cursor - Cursor for the round, or false on the first call.
 * @returns Procedure with the extracted page.
 */
async function runPageFetch<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
  cursor: TCursor | false,
): Promise<Procedure<IPage<object, TCursor>>> {
  const dispatchArgs = buildTxnsDispatchArgs(a, cursor);
  const resp = await dispatchStep(dispatchArgs);
  if (!isOk(resp)) return resp;
  const args = { body: resp.value, cursor, acct: a.acct, ctx: a.ctx };
  const page = a.shape.transactions.extractPage(args);
  return succeed(page);
}

/**
 * Build the page fetcher closure for one account.
 * @param a - Per-account context.
 * @returns Bound page fetcher consumed by fetchPaginated.
 */
export function buildPageFetcher<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
): PageFetcher<TCursor> {
  return (cursor): Promise<Procedure<IPage<object, TCursor>>> => runPageFetch(a, cursor);
}

/** Stop predicate signature consumed by fetchPaginated. */
type BoundStop = (acc: readonly object[]) => ShouldStop;

/**
 * No-op stop predicate — used when the shape omits a custom stop.
 * @returns False (never stop).
 */
function neverStop(): ShouldStop {
  return false as ShouldStop;
}

/**
 * Bind the shape's stop predicate to action context; default to neverStop.
 * @param d - Driver context.
 * @returns fetchPaginated-compatible stop predicate.
 */
export function buildStop<TAcct, TCursor>(d: IDriverCtx<TAcct, TCursor>): BoundStop {
  const stop = d.shape.transactions.stop;
  if (!stop) return neverStop;
  return (acc): ShouldStop => stop(acc, d.ctx) as ShouldStop;
}
