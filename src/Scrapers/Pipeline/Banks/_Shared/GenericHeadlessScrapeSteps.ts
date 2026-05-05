/**
 * Per-step helpers for the generic headless scrape driver.
 * Split from GenericHeadlessScrape.ts to respect the 150-LOC ceiling.
 * Zero bank-name coupling.
 */

import type { IApiMediator, IApiQueryOpts } from '../../Mediator/Api/ApiMediator.js';
import type { IPage } from '../../Strategy/Fetch/Pagination.js';
import type { IActionContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';
import type {
  ApiBody,
  HeaderMap,
  HeadlessHeadersLike,
  IHeadlessScrapeShape,
} from './HeadlessScrapeShape.js';

const FROZEN_EMPTY_HEADERS: HeaderMap = Object.freeze({});
const FROZEN_EMPTY_OPTS: IApiQueryOpts = Object.freeze({ extraHeaders: FROZEN_EMPTY_HEADERS });

/** Whether pagination should terminate after the current accumulator. */
type ShouldStop = boolean;

/** Driver context — shape + bus + action context. */
export interface IDriverCtx<TAcct, TCursor> {
  readonly shape: IHeadlessScrapeShape<TAcct, TCursor>;
  readonly bus: IApiMediator;
  readonly ctx: IActionContext;
}

/** Per-account context — driver context + current account. */
export interface IAcctCtx<TAcct, TCursor> extends IDriverCtx<TAcct, TCursor> {
  readonly acct: TAcct;
}

/**
 * Resolve a HeadlessHeadersLike to a concrete HeaderMap — calls the
 * function at call time when the shape declared a dynamic producer.
 * @param ctx - Action context passed into dynamic producers.
 * @param extra - Static map, function, or absent.
 * @returns Concrete header map (frozen empty when absent).
 */
function resolveHeaders(ctx: IActionContext, extra?: HeadlessHeadersLike): HeaderMap {
  if (!extra) return FROZEN_EMPTY_HEADERS;
  if (typeof extra === 'function') return extra(ctx);
  return extra;
}

/**
 * Build IApiQueryOpts from optional extraHeaders (frozen singleton default).
 * @param ctx - Action context for dynamic producers.
 * @param extra - Static map, function, or absent.
 * @returns Opts value consumed by apiQuery.
 */
function toOpts(ctx: IActionContext, extra?: HeadlessHeadersLike): IApiQueryOpts {
  const headers = resolveHeaders(ctx, extra);
  if (Object.keys(headers).length === 0) return FROZEN_EMPTY_OPTS;
  return { extraHeaders: headers };
}

/**
 * Fetch customer tree and extract the flat account list.
 * @param d - Driver context.
 * @returns Account refs procedure.
 */
export async function fetchAccounts<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
): Promise<Procedure<readonly TAcct[]>> {
  const vars = d.shape.customer.buildVars(d.ctx);
  const opts = toOpts(d.ctx, d.shape.customer.extraHeaders);
  const resp = await d.bus.apiQuery<ApiBody>('customer', vars, opts);
  if (!isOk(resp)) return resp;
  const accts = d.shape.customer.extractAccounts(resp.value);
  return succeed(accts);
}

/**
 * Fetch one account's balance, honouring fallbackOnFail when set.
 * @param a - Per-account context.
 * @returns Balance procedure.
 */
export async function fetchBalance<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
): Promise<Procedure<number>> {
  const vars = a.shape.balance.buildVars(a.acct);
  const opts = toOpts(a.ctx, a.shape.balance.extraHeaders);
  const resp = await a.bus.apiQuery<ApiBody>('balance', vars, opts);
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
 * Build the page fetcher closure for one account.
 * @param a - Per-account context.
 * @returns Bound page fetcher consumed by fetchPaginated.
 */
export function buildPageFetcher<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
): PageFetcher<TCursor> {
  return async (cursor): Promise<Procedure<IPage<object, TCursor>>> => {
    const vars = a.shape.transactions.buildVars(a.acct, cursor, a.ctx);
    const opts = toOpts(a.ctx, a.shape.transactions.extraHeaders);
    const resp = await a.bus.apiQuery<ApiBody>('transactions', vars, opts);
    if (!isOk(resp)) return resp;
    const page = a.shape.transactions.extractPage(resp.value, cursor);
    return succeed(page);
  };
}

/** Stop predicate signature consumed by fetchPaginated. */
type BoundStop = (acc: readonly object[]) => boolean;

/**
 * No-op stop predicate — used when the shape omits a custom stop.
 * @returns False (never stop).
 */
function neverStop(): ShouldStop {
  return false;
}

/**
 * Bind the shape's stop predicate to action context; default to neverStop.
 * @param d - Driver context.
 * @returns fetchPaginated-compatible stop predicate.
 */
export function buildStop<TAcct, TCursor>(d: IDriverCtx<TAcct, TCursor>): BoundStop {
  const stop = d.shape.transactions.stop;
  if (!stop) return neverStop;
  return (acc): ShouldStop => stop(acc, d.ctx);
}
