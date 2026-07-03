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
} from './ApiDirectScrapeDispatchArgs.js';
import type { IBalanceOutcome } from './IApiDirectScrapeShape.js';

/** Stop signal — branded so Rule #15 accepts the boolean return. */
type ShouldStop = Brand<boolean, 'GenericHeadlessShouldStop'>;

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
 * Fetch one account's balance, honouring fallbackOnFail when set.
 * @param a - Per-account context.
 * @returns Balance outcome procedure (value + degraded flag).
 */
export async function fetchBalance<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
): Promise<Procedure<IBalanceOutcome>> {
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
