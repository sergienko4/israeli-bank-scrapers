/**
 * Per-step fetch orchestration for the ApiDirectScrape phase driver.
 * Consumes dispatch-args builders from ApiDirectScrapeDispatchArgs and
 * dispatchStep from ApiDirectScrapeDispatch; walks customer → balance →
 * paginated transactions. Zero bank-name coupling.
 */

import type { IPage } from '../../Strategy/Fetch/Pagination.js';
import type { Brand } from '../../Types/Brand.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';
import { dispatchStep } from './ApiDirectScrapeDispatch.js';
import {
  buildBalanceDispatchArgs,
  buildCustomerDispatchArgs,
  buildTxnsDispatchArgs,
  type IAcctCtx,
  type IDriverCtx,
  resolveSecondaryUrlTag,
} from './ApiDirectScrapeDispatchArgs.js';
import type { ApiBody, IBalanceOutcome } from './IApiDirectScrapeShape.js';

/** Stop signal — branded so Rule #15 accepts the boolean return. */
type ShouldStop = Brand<boolean, 'GenericHeadlessShouldStop'>;

/** Empty body passed to a step's extractor when it skips the fetch. */
const EMPTY_BODY = Object.freeze({});

/**
 * Fetch the optional secondary identity GET declared by
 * `customer.secondaryUrlTag`; yields EMPTY_BODY when none is declared so
 * `extractAccounts` always receives a defined `secondaryBody`.
 * @param d - Driver context.
 * @returns Secondary identity body procedure.
 */
async function fetchSecondaryBody<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
): Promise<Procedure<ApiBody>> {
  const tag = resolveSecondaryUrlTag(d);
  if (tag === false) return succeed<ApiBody>(EMPTY_BODY);
  return d.bus.apiGet<ApiBody>(tag);
}

/**
 * Run `extractAccounts` against a primary body plus the optional
 * secondary-identity body and the post-login session-context.
 * @param d - Driver context.
 * @param body - Primary customer-fetch body (EMPTY_BODY when skipped).
 * @returns Account refs procedure.
 */
async function extractAccts<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
  body: ApiBody,
): Promise<Procedure<readonly TAcct[]>> {
  const secondary = await fetchSecondaryBody(d);
  if (!isOk(secondary)) return secondary;
  const sessionContext = d.bus.getSessionContext();
  const args = { body, secondaryBody: secondary.value, sessionContext };
  const accts = d.shape.customer.extractAccounts(args);
  return succeed(accts);
}

/**
 * Fetch customer tree and extract the flat account list. Honours
 * `customer.skipFetch === true` by bypassing the network call, and
 * `customer.secondaryUrlTag` by folding a second identity GET into
 * `extractAccounts` as `secondaryBody`.
 * @param d - Driver context.
 * @returns Account refs procedure.
 */
export async function fetchAccounts<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
): Promise<Procedure<readonly TAcct[]>> {
  if (d.shape.customer.skipFetch === true) return extractAccts(d, EMPTY_BODY);
  const dispatchArgs = buildCustomerDispatchArgs(d);
  const resp = await dispatchStep(dispatchArgs);
  if (!isOk(resp)) return resp;
  return extractAccts(d, resp.value);
}

/**
 * Fetch one account's balance, honouring fallbackOnFail when set.
 * @param a - Per-account context.
 * @returns Balance outcome procedure (value + degraded flag).
 */
export async function fetchBalance<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
): Promise<Procedure<IBalanceOutcome>> {
  if (a.shape.balance.skipFetch === true) {
    return succeed({ value: a.shape.balance.extract(EMPTY_BODY), degraded: false });
  }
  const dispatchArgs = buildBalanceDispatchArgs(a);
  const resp = await dispatchStep(dispatchArgs);
  if (isOk(resp)) return succeed({ value: a.shape.balance.extract(resp.value), degraded: false });
  const fb = a.shape.balance.fallbackOnFail;
  if (fb === undefined) return resp;
  return succeed({ value: fb, degraded: true });
}

/** Page fetcher signature consumed by fetchPaginated. */
type PageFetcher<TCursor> = (cursor: TCursor | false) => Promise<Procedure<IPage<object, TCursor>>>;

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
