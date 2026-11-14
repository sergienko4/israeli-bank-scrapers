/**
 * Response helpers shared by redirect senders: status detection, the
 * answering URL, Set-Cookie emission, and the run/answer shape every sender
 * reads and returns. The shape lives here so a sender never imports the
 * dispatcher that calls it.
 */

import type { Brand } from '../../Types/Brand.js';
import type { IResponseReading, RedirectPolicy } from '../../Types/Domain/FetchPolicy.js';
import type { Procedure } from '../../Types/Procedure.js';
import type {
  FetchInvoke,
  IFetchInvokePolicy,
  ISessionHeaders,
  OnSetCookie,
} from './FetchStrategy.js';

/** Count of Set-Cookie lines a response emitted. */
type SetCookieEmitCount = Brand<number, 'SetCookieEmitCount'>;

/** One request, its transport seam and the redirect policy it runs under. */
interface IRedirectRun extends IFetchInvokePolicy {
  readonly url: string;
  readonly init: RequestInit;
  readonly invoke: FetchInvoke;
  readonly policy: RedirectPolicy;
  readonly onSetCookie?: OnSetCookie;
  readonly sessionHeadersFor?: (url: string) => Procedure<ISessionHeaders>;
  /** How the call reads its answer; dispatched runs always set it. */
  readonly reading?: IResponseReading;
}

/** The response that ended a run and the URL its Set-Cookie lines belong to. */
interface IRunEnd {
  readonly response: Response;
  readonly responseUrl: string;
}

/**
 * Whether a status is a redirect.
 * @param status - HTTP status.
 * @returns True for any 3xx.
 */
function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

/**
 * The URL a response's cookies belong to: its own, else the request's.
 * @param response - The response.
 * @param requestUrl - The URL that was requested.
 * @returns The answering URL.
 */
function answeredUrl(response: Response, requestUrl: string): string {
  if (response.url === '') return requestUrl;
  return response.url;
}

/**
 * Hand a response's raw Set-Cookie lines (Node 18+ `getSetCookie`, which
 * keeps multi-value headers apart) to the hook, when there is one.
 * @param response - Raw fetch Response.
 * @param responseUrl - URL the lines are filed under.
 * @param hook - Optional caller-supplied callback.
 * @returns Number of lines emitted (0 with no hook or no cookies).
 */
function emitSetCookies(
  response: Response,
  responseUrl: string,
  hook?: OnSetCookie,
): SetCookieEmitCount {
  const list = response.headers.getSetCookie();
  if (!hook || list.length === 0) return 0 as SetCookieEmitCount;
  hook(list, responseUrl);
  return list.length as SetCookieEmitCount;
}

export { answeredUrl, emitSetCookies, isRedirectStatus };
export type { IRedirectRun, IRunEnd, SetCookieEmitCount };
