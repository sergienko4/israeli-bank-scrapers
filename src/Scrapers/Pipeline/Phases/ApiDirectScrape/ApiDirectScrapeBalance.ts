/**
 * ApiDirectScrape balance step — fetch one account's current balance.
 *
 * Split out of ApiDirectScrapeSteps.ts to keep that file under the per-file
 * LOC ceiling. The step answers three distinct outcomes and never conflates
 * them: a live figure, an UNKNOWN figure (degraded, no value — the response
 * or the call did not carry one), and a hard failure that discards the run.
 */

import type { IProcedureFailure, Procedure } from '../../Types/Procedure.js';
import { isOk, isTerminalFailure, succeed } from '../../Types/Procedure.js';
import { dispatchStep } from './ApiDirectScrapeDispatch.js';
import { buildBalanceDispatchArgs } from './ApiDirectScrapeDispatchArgs.js';
import type { IAcctCtx } from './ApiDirectScrapeTypes.js';
import type { ApiBody, BalanceUnknown, IBalanceOutcome } from './IApiDirectScrapeShape.js';
import { BALANCE_UNKNOWN } from './IApiDirectScrapeShape.js';
import { guardShape } from './ShapeGuard.js';

/** Stand-in body handed to `extract` when the shape skips the fetch. */
const EMPTY_BALANCE_BODY = Object.freeze({});

/**
 * Ask the shape whether a successful response carried no figure.
 * @param a - Per-account context.
 * @param body - Balance response (or the empty body when the fetch is skipped).
 * @returns True when the figure is absent; false when present or undeclared.
 */
function absenceDeclared<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
  body: ApiBody,
): Procedure<boolean> {
  const declaredAbsent = a.shape.balance.isAbsent;
  if (!declaredAbsent) return succeed(false);
  return guardShape('balance.isAbsent', () => declaredAbsent(body, a.acct));
}

/**
 * Read the balance out of a response body.
 *
 * A shape that declares the figure absent (see
 * {@link IApiDirectScrapeBalanceStep.isAbsent}) yields a degraded outcome
 * carrying no value, rather than a `0` indistinguishable from a genuinely
 * empty account. Both shape callbacks run through {@link guardShape}, so a
 * throw becomes a typed failure instead of escaping the phase.
 * @param a - Per-account context.
 * @param body - Balance response (or the empty body when the fetch is skipped).
 * @returns Balance outcome procedure.
 */
function readBalance<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
  body: ApiBody,
): Procedure<IBalanceOutcome> {
  const absent = absenceDeclared(a, body);
  if (!isOk(absent)) return absent;
  if (absent.value) return succeed({ degraded: true });
  return extractedBalance(a, body);
}

/**
 * Run the shape's balance extractor and mark the figure as live.
 * @param a - Per-account context.
 * @param body - Balance response (or the empty body when the fetch is skipped).
 * @returns The live figure, or the guard's typed failure.
 */
function extractedBalance<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
  body: ApiBody,
): Procedure<IBalanceOutcome> {
  const extracted = guardShape('balance.extract', () => a.shape.balance.extract(body, a.acct));
  if (!isOk(extracted)) return extracted;
  return succeed({ value: extracted.value, degraded: false });
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
 * issue a second call. An edge (WAF) or integrity refusal is never answered
 * from the fallback: a degraded success would hide it from the caller.
 * @param a - Per-account context.
 * @returns Balance outcome procedure (value + degraded flag).
 */
export async function fetchBalance<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
): Promise<Procedure<IBalanceOutcome>> {
  const resp = await dispatchBalance(a);
  if (isOk(resp)) return readBalance(a, resp.value);
  return failedBalance(a, resp);
}

/**
 * Answer a failed balance call, honouring the shape's declared fallback.
 * @param a - Per-account context.
 * @param resp - The failed balance response.
 * @returns The response, or a degraded outcome from the declared fallback.
 */
function failedBalance<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
  resp: IProcedureFailure,
): Procedure<IBalanceOutcome> {
  const fb = a.shape.balance.fallbackOnFail;
  if (fb === undefined || isTerminalFailure(resp)) return resp;
  const degraded = balanceFallback(fb);
  return succeed(degraded);
}

export default fetchBalance;
