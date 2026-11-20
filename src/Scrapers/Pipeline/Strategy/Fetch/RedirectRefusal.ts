/**
 * Redirect refusal — the body-free failure a transport returns when it will
 * not follow a 3xx, plus the typed status and target a step may classify.
 * The message never names the target; only its origin and path travel on the
 * failure, so an auth check can match without exposing a query or headers.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { REDIRECT_REFUSED_REASON } from '../../Types/Domain/FetchPolicy.js';
import type { Option } from '../../Types/Option.js';
import { none, some } from '../../Types/Option.js';
import type { IRedirectRefusal, Procedure } from '../../Types/Procedure.js';
import { fail } from '../../Types/Procedure.js';
import type { IRedirectRun, IRunEnd } from './RedirectShared.js';
import { safeUrlForLog } from './SafeUrlForLog.js';

/** What a refusal reports: status, parsed target and whether the message names the status. */
interface IRefusalOptions {
  readonly status?: number;
  readonly target?: URL;
  /** Manual-policy refusals keep the old status-free message. */
  readonly isStatusInMessage?: boolean;
}

/**
 * Resolve a redirect's target for classification, without following it.
 * @param response - The redirect response.
 * @param baseUrl - URL the response answered.
 * @returns The parsed target, or none when no Location parses.
 */
function redirectTargetOf(response: Response, baseUrl: string): Option<URL> {
  const location = response.headers.get('location');
  if (location === null || !URL.canParse(location, baseUrl)) return none();
  return some(new URL(location, baseUrl));
}

/**
 * Build the body-free refusal message.
 * @param run - The run.
 * @param isStatusInMessage - Whether the message names the status.
 * @param status - Refusal status, when known.
 * @returns The fixed message.
 */
function refusalMessage(run: IRedirectRun, isStatusInMessage: boolean, status?: number): string {
  const safeUrl = safeUrlForLog(run.url, run.redactUrlValues);
  const statusText = status === undefined || !isStatusInMessage ? '' : `HTTP ${String(status)} `;
  return `${run.verb} ${safeUrl} ${statusText}${REDIRECT_REFUSED_REASON}`;
}

/**
 * Describe a refused redirect without its query or headers.
 * @param status - Refusal status.
 * @param target - Parsed target, when known.
 * @returns The typed refusal.
 */
function redirectRefusalOf(status: number, target?: URL): IRedirectRefusal {
  const origin = target === undefined ? '' : target.origin;
  const path = target === undefined ? '' : target.pathname;
  return { status, origin, path };
}

/**
 * Refuse a redirect without naming the refused target in the message.
 * @param run - The run.
 * @param options - Status, parsed target and whether the message names the status.
 * @returns Generic failure naming only the request URL, with the target's
 *   origin and path for the step's opt-in classification.
 */
function refused(run: IRedirectRun, options: IRefusalOptions = {}): Procedure<IRunEnd> {
  const { status, target } = options;
  const message = refusalMessage(run, options.isStatusInMessage !== false, status);
  const failure = fail(ScraperErrorTypes.Generic, message);
  if (status === undefined) return failure;
  return { ...failure, redirectRefusal: redirectRefusalOf(status, target) };
}

export type { IRefusalOptions };
export { redirectTargetOf, refused };
