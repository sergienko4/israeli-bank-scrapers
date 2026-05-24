/**
 * Per-step helpers for the ApiDirectScrape phase driver.
 * Split from ApiDirectScrapeActions.ts to respect the 150-LOC ceiling.
 * Zero bank-name coupling.
 */

import type { IApiMediator, IApiQueryOpts } from '../../Mediator/Api/ApiMediator.js';
import type { WKQueryOperation } from '../../Registry/WK/QueriesWK.js';
import type { WKUrlGroup } from '../../Registry/WK/UrlsWK.js';
import type { IPage } from '../../Strategy/Fetch/Pagination.js';
import type { Brand } from '../../Types/Brand.js';
import type { IActionContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';
import type {
  ApiBody,
  ApiDirectScrapeHeadersLike,
  HeaderMap,
  IApiDirectScrapeShape,
  VarsMap,
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
 * Resolve a ApiDirectScrapeHeadersLike to a concrete HeaderMap — calls the
 * function at call time when the shape declared a dynamic producer.
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
 * Build IApiQueryOpts from optional extraHeaders (frozen singleton default).
 * @param ctx - Action context for dynamic producers.
 * @param extra - Static map, function, or absent.
 * @returns Opts value consumed by apiQuery.
 */
function toOpts(ctx: IActionContext, extra?: ApiDirectScrapeHeadersLike): IApiQueryOpts {
  const headers = resolveHeaders(ctx, extra);
  if (Object.keys(headers).length === 0) return FROZEN_EMPTY_OPTS;
  return { extraHeaders: headers };
}

/** Args bundle for {@link dispatchScrape} — keeps params ≤3. */
interface IDispatchArgs {
  readonly bus: IApiMediator;
  readonly queryTag: WKQueryOperation;
  /** REST URL tag, or `false` when the step should use GraphQL. */
  readonly urlTag: WKUrlGroup | false;
  readonly vars: VarsMap;
  readonly opts: IApiQueryOpts;
}

/**
 * Dispatch one scrape step against the mediator. When the shape
 * supplied a `urlTag` the call routes through REST (`bus.apiPost`);
 * otherwise it falls back to the GraphQL default (`bus.apiQuery`).
 * `vars` is the same record either way — for REST banks it is the
 * request body; for GraphQL banks it is the variables map.
 * @param args - Dispatch bundle.
 * @returns Procedure with the typed payload.
 */
async function dispatchScrape(args: IDispatchArgs): Promise<Procedure<ApiBody>> {
  if (args.urlTag !== false) {
    return args.bus.apiPost<ApiBody>(args.urlTag, args.vars, args.opts);
  }
  return args.bus.apiQuery<ApiBody>(args.queryTag, args.vars, args.opts);
}

/**
 * Generic resolver for a defined urlTag spec — picks between literal
 * and producer-function variants. Callers handle the `undefined` case
 * (GraphQL fallback) before invoking this helper, so the spec param
 * here is always present. Folding the literal/producer split into one
 * helper keeps the branch count constant as new scrape steps adopt the
 * urlTag pattern.
 * @param spec - Literal WK URL tag or producer function.
 * @param producerArgs - Arguments forwarded when `spec` is a function.
 * @returns Resolved WK URL tag.
 */
function resolveUrlTagSpec<TArgs extends readonly unknown[]>(
  spec: WKUrlGroup | ((...args: TArgs) => WKUrlGroup),
  producerArgs: TArgs,
): WKUrlGroup {
  if (typeof spec === 'function') return spec(...producerArgs);
  return spec;
}

/**
 * Resolve the customer step's optional REST urlTag (static or producer).
 * @param d - Driver context.
 * @returns WK URL tag or `false` when the step is GraphQL.
 */
function resolveCustomerUrlTag<TAcct, TCursor>(d: IDriverCtx<TAcct, TCursor>): WKUrlGroup | false {
  const spec = d.shape.customer.urlTag;
  if (spec === undefined) return false;
  return resolveUrlTagSpec(spec, [d.ctx] as const);
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
  const urlTag = resolveCustomerUrlTag(d);
  const resp = await dispatchScrape({ bus: d.bus, queryTag: 'customer', urlTag, vars, opts });
  if (!isOk(resp)) return resp;
  const accts = d.shape.customer.extractAccounts(resp.value);
  return succeed(accts);
}

/**
 * Resolve the balance step's optional REST urlTag (static or producer).
 * @param a - Per-account context.
 * @returns WK URL tag or `false` when the step is GraphQL.
 */
function resolveBalanceUrlTag<TAcct, TCursor>(a: IAcctCtx<TAcct, TCursor>): WKUrlGroup | false {
  const spec = a.shape.balance.urlTag;
  if (spec === undefined) return false;
  return resolveUrlTagSpec(spec, [a.acct] as const);
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
  const urlTag = resolveBalanceUrlTag(a);
  const resp = await dispatchScrape({ bus: a.bus, queryTag: 'balance', urlTag, vars, opts });
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
 * Resolve the transactions step's optional REST urlTag.
 * @param a - Per-account context.
 * @param cursor - Cursor passed into the producer (when dynamic).
 * @returns WK URL tag or `false` when the step is GraphQL.
 */
function resolveTxnsUrlTag<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
  cursor: TCursor | false,
): WKUrlGroup | false {
  const spec = a.shape.transactions.urlTag;
  if (spec === undefined) return false;
  return resolveUrlTagSpec(spec, [a.acct, cursor, a.ctx] as const);
}

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
    const urlTag = resolveTxnsUrlTag(a, cursor);
    const resp = await dispatchScrape({ bus: a.bus, queryTag: 'transactions', urlTag, vars, opts });
    if (!isOk(resp)) return resp;
    const page = a.shape.transactions.extractPage(resp.value, cursor);
    return succeed(page);
  };
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
