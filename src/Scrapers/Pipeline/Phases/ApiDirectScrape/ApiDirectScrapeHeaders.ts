/**
 * Header resolution for the ApiDirectScrape phase driver (N53).
 * Turns a step's `extraHeaders` — a static map or a producer — into the
 * call's IApiQueryOpts, handing a producer the call's IScrapeCallInfo.
 * The info is read lazily, so a static map never touches the account.
 * Split out of ApiDirectScrapeDispatchArgs.ts to keep it within the
 * per-file LOC ceiling. Zero bank-name coupling.
 */

import type { IApiQueryOpts } from '../../Mediator/Api/ApiMediator.js';
import type { IActionContext } from '../../Types/PipelineContext.js';
import type {
  ApiDirectScrapeHeadersLike,
  HeaderMap,
  IScrapeCallInfo,
} from './IApiDirectScrapeShape.js';

const FROZEN_EMPTY_HEADERS: HeaderMap = Object.freeze({});
const FROZEN_EMPTY_OPTS: IApiQueryOpts = Object.freeze({ extraHeaders: FROZEN_EMPTY_HEADERS });
const NO_ACCOUNT: IScrapeCallInfo = Object.freeze({});

/** Produces a call's info on demand, so a static header map never reads the account. */
type CallInfoOf = () => IScrapeCallInfo;

/**
 * Call info for a call that belongs to no account.
 * @returns The frozen empty call info.
 */
function noAccount(): IScrapeCallInfo {
  return NO_ACCOUNT;
}

/**
 * Resolve a ApiDirectScrapeHeadersLike to a concrete HeaderMap.
 * @param ctx - Action context passed into dynamic producers.
 * @param callOf - Supplies the call info, read only for a producer.
 * @param extra - Static map, function, or absent.
 * @returns Concrete header map (frozen empty when absent).
 */
function resolveHeaders(
  ctx: IActionContext,
  callOf: CallInfoOf,
  extra?: ApiDirectScrapeHeadersLike,
): HeaderMap {
  if (!extra) return FROZEN_EMPTY_HEADERS;
  if (typeof extra !== 'function') return extra;
  const call = callOf();
  return extra(ctx, call);
}

/**
 * Build IApiQueryOpts from optional extraHeaders. Returns the frozen
 * empty sentinel when no headers are supplied so consumers can pin
 * `===` checks against it. A header whose value is `''` still counts.
 * @param ctx - Action context for dynamic producers.
 * @param callOf - Supplies the call info, read only for a producer.
 * @param extra - Static map, function, or absent.
 * @returns Opts value.
 */
function headerOpts(
  ctx: IActionContext,
  callOf: CallInfoOf,
  extra?: ApiDirectScrapeHeadersLike,
): IApiQueryOpts {
  const headers = resolveHeaders(ctx, callOf, extra);
  if (Object.keys(headers).length === 0) return FROZEN_EMPTY_OPTS;
  return { extraHeaders: headers };
}

/**
 * Build the opts of a call that belongs to no account (bootstrap,
 * customer and the customer's secondary identity GET).
 * @param ctx - Action context for dynamic producers.
 * @param extra - Static map, function, or absent.
 * @returns Opts value.
 */
function accountlessOpts(ctx: IActionContext, extra?: ApiDirectScrapeHeadersLike): IApiQueryOpts {
  return headerOpts(ctx, noAccount, extra);
}

export default headerOpts;
export { accountlessOpts, headerOpts };
