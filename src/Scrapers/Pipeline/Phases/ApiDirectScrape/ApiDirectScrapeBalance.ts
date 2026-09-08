/**
 * ApiDirectScrape balance step — fetch one account's current balance.
 *
 * Split out of ApiDirectScrapeSteps.ts to keep that file under the per-file
 * LOC ceiling. The step answers three distinct outcomes and never conflates
 * them: a live figure, an UNKNOWN figure (degraded, no value — the response
 * or the call did not carry one), and a hard failure that discards the run.
 */

import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';
import { dispatchStep } from './ApiDirectScrapeDispatch.js';
import type { IAcctCtx } from './ApiDirectScrapeDispatchArgs.js';
import { buildBalanceDispatchArgs } from './ApiDirectScrapeDispatchArgs.js';
import type { ApiBody, BalanceUnknown, IBalanceOutcome } from './IApiDirectScrapeShape.js';
import { BALANCE_UNKNOWN } from './IApiDirectScrapeShape.js';

/** Stand-in body handed to `extract` when the shape skips the fetch. */
const EMPTY_BALANCE_BODY = Object.freeze({});

/**
 * Read the balance out of a response body.
 *
 * A shape that declares the figure absent (see
 * {@link IApiDirectScrapeBalanceStep.isAbsent}) yields a degraded outcome
 * carrying no value, rather than a `0` indistinguishable from a genuinely
 * empty account.
 * @param a - Per-account context.
 * @param body - Balance response (or the empty body when the fetch is skipped).
 * @returns Balance outcome.
 */
function readBalance<TAcct, TCursor>(a: IAcctCtx<TAcct, TCursor>, body: ApiBody): IBalanceOutcome {
  const declaredAbsent = a.shape.balance.isAbsent;
  if (declaredAbsent?.(body, a.acct) === true) return { degraded: true };
  const value = a.shape.balance.extract(body, a.acct);
  return { value, degraded: false };
}

/**
 * Answer a FAILED balance call from the shape's declared fallback.
 * @param fb - The shape's declared fallback.
 * @returns Degraded outcome — valueless for {@link BALANCE_UNKNOWN}.
 */
function balanceFallback(fb: number | BalanceUnknown): IBalanceOutcome {
  if (fb === BALANCE_UNKNOWN) return { degraded: true };
  return { value: fb, degraded: true };
}

/**
 * Obtain the balance body — the declared shortcut when the shape skips the
 * fetch, otherwise the dispatched response.
 * @param a - Per-account context.
 * @returns Balance response procedure.
 */
async function dispatchBalance<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
): Promise<Procedure<ApiBody>> {
  if (a.shape.balance.skipFetch === true) return succeed<ApiBody>(EMPTY_BALANCE_BODY);
  const dispatchArgs = buildBalanceDispatchArgs(a);
  return dispatchStep(dispatchArgs);
}

/**
 * Fetch one account's balance, honouring fallbackOnFail when set.
 *
 * `extract` receives the account as well as the response so a shape whose
 * balance already rode an earlier step can answer from it (Max) rather than
 * issue a second call.
 * @param a - Per-account context.
 * @returns Balance outcome procedure (value + degraded flag).
 */
export async function fetchBalance<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
): Promise<Procedure<IBalanceOutcome>> {
  const resp = await dispatchBalance(a);
  if (isOk(resp)) {
    const fetched = readBalance(a, resp.value);
    return succeed(fetched);
  }
  const fb = a.shape.balance.fallbackOnFail;
  if (fb === undefined) return resp;
  const fallback = balanceFallback(fb);
  return succeed(fallback);
}

export default fetchBalance;
