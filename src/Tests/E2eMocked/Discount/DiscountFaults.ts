/**
 * Discount mock run state — the faults the synthetic bank can play, the
 * brand a run plays and what it remembers between calls, the guard every call
 * after the login page passes (the latest XSRF-TOKEN, decoded, plus the
 * cookies the route needs) and the MI6 guard of every call after the login.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import type { IRecordedCall } from '../Helpers/FetchMockKit.js';
import { errorReply } from '../Helpers/FetchMockKit.js';
import { hasCookies } from '../Helpers/MockReplies.js';
import type { ITelebankMockBrand } from './DiscountBrands.js';
import { md5Of } from './DiscountMockData.js';

/** How the mock misbehaves: a login-page, key, login, binding or Titan fault. */
export type DiscountFault =
  | 'none'
  | 'csrfPage'
  | 'emptyLanguage'
  | 'noTuuid'
  | 'malformedXsrf'
  | 'malformedHopXsrf'
  | 'derKey'
  | 'actionRequired'
  | 'login307'
  | 'loginQuery'
  | 'mi6Mismatch'
  | 'titanError'
  | 'titan500';

/** What one run remembers between calls. */
export interface IDiscountMockRun {
  readonly fault: DiscountFault;
  /** The bank the run plays. */
  readonly brand: ITelebankMockBrand;
  /** The decoded XSRF-TOKEN the next call must send ('' before the login page). */
  xsrf: string;
  /** The `Uid` login named ('' before login). */
  uid: string;
  /** Whether login's seals opened to the synthetic credentials. */
  isLoginOk: boolean;
}

/** One route: answers a recorded call within a run. */
export type Route = (call: IRecordedCall, run: IDiscountMockRun) => Response;

/** Text the bank puts in a refusal; it must never surface. */
export const DC_BANK_NOTICE = 'SYNTHETIC bank notice 4417';

/**
 * A Set-Cookie line for a host-only pair.
 * @param pair - `name=value`.
 * @returns The line, scoped to the whole host.
 */
export function setCookie(pair: string): string {
  return `${pair}; Path=/; Secure`;
}

/**
 * Guard a route behind the latest XSRF-TOKEN and the cookies it needs.
 * @param cookies - Pairs the call's Cookie header must hold.
 * @param route - The route behind the guard.
 * @returns A route answering 403 to a call without them.
 */
export function guarded(cookies: readonly string[], route: Route): Route {
  return (call: IRecordedCall, run: IDiscountMockRun): Response => {
    const isXsrfRight = call.headers.get('x-xsrf-token') === run.xsrf;
    return isXsrfRight && hasCookies(call, cookies) ? route(call, run) : errorReply(403);
  };
}

/**
 * Whether a call carries the MI6 cookie bound to the `Uid` login named.
 * @param call - The recorded request.
 * @param run - The run's state.
 * @returns True when the binding is present.
 */
function hasMi6Binding(call: IRecordedCall, run: IDiscountMockRun): boolean {
  const binding = `mi6=${md5Of(run.uid)}`;
  return hasCookies(call, [binding]);
}

/**
 * Guard a route as `guarded` does, and behind the MI6 cookie bound to the
 * `Uid` login named.
 * @param cookies - Pairs the call's Cookie header must hold besides the binding.
 * @param route - The route behind the guard.
 * @returns A route answering 403 to a call without them or the binding.
 */
export function mi6Guarded(cookies: readonly string[], route: Route): Route {
  return guarded(cookies, (call: IRecordedCall, run: IDiscountMockRun): Response => {
    return hasMi6Binding(call, run) ? route(call, run) : errorReply(403);
  });
}
