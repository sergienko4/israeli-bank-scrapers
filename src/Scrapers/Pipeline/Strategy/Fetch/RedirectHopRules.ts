/**
 * Redirect hop rules — what a manual hop may follow and what it never sends
 * (N2, N46), as the Fetch standard has them. An answer to a GET is followed on
 * 301/302/303/307/308. An answer to a POST is followed only under `postAsGet`
 * and only on 302/303, the statuses that turn a POST into a GET; its GET hop
 * drops the request-body headers. Once a run has crossed origins every hop
 * drops the credentials headers.
 */

import type { IManualRedirect } from '../../Types/Domain/FetchPolicy.js';
import type { HttpVerb, ISessionHeaders } from './FetchStrategy.js';

/** Redirect statuses a manual policy may follow on an answer to a GET. */
const FOLLOWED_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/** Statuses that turn a POST into a GET, followed under `postAsGet`. */
const POST_AS_GET_STATUSES: ReadonlySet<number> = new Set([302, 303]);

/** No status: an answer to a POST without `postAsGet` is never followed. */
const NO_STATUSES: ReadonlySet<number> = new Set();

/** Credentials headers a hop to another origin never carries. */
const CROSS_ORIGIN_DROPPED = ['authorization', 'proxy-authorization'] as const;

/** Request-body headers the GET hop after a POST never carries. */
const BODY_HEADERS = [
  'content-encoding',
  'content-language',
  'content-location',
  'content-type',
] as const;

/**
 * The statuses an answer to a POST is followed on under a manual policy.
 * @param policy - The manual policy.
 * @returns 302/303 under `postAsGet`, else none.
 */
function postStatusesOf(policy: IManualRedirect): ReadonlySet<number> {
  return policy.postAsGet === true ? POST_AS_GET_STATUSES : NO_STATUSES;
}

/**
 * The statuses a redirect may be followed on, by the verb that drew it.
 * @param verb - Verb of the request that drew the redirect.
 * @param postStatuses - The run's statuses for an answer to a POST.
 * @returns Every manual status after a GET, the POST statuses else.
 */
function followedAfter(verb: HttpVerb, postStatuses: ReadonlySet<number>): ReadonlySet<number> {
  return verb === 'GET' ? FOLLOWED_STATUSES : postStatuses;
}

/**
 * The headers a hop drops after the session's are added.
 * @param wasPost - Whether the run that redirects began as a POST.
 * @param hasCrossed - Whether any hop so far changed origin.
 * @returns Lower-case names: the credentials once crossed, the body headers
 *   on every hop of a POST-originated run.
 */
function droppedOnHop(wasPost: boolean, hasCrossed: boolean): readonly string[] {
  const credentials = hasCrossed ? CROSS_ORIGIN_DROPPED : [];
  const body = wasPost ? BODY_HEADERS : [];
  return [...credentials, ...body];
}

/**
 * Clone the previous headers and replace the session-owned values.
 * @param previous - Headers of the request that redirected.
 * @param session - Session ownership and values for its URL.
 * @returns Fresh headers with the hop's session values.
 */
function replaceSessionHeaders(
  previous: RequestInit['headers'],
  session: ISessionHeaders,
): Headers {
  const headers = new Headers(previous);
  for (const name of session.owned) headers.delete(name);
  for (const [name, value] of Object.entries(session.values)) headers.set(name, value);
  return headers;
}

/**
 * Rebuild a hop's headers, dropping forbidden names after session replacement.
 * @param previous - Headers of the request that redirected.
 * @param session - The session's headers for the hop URL.
 * @param dropped - Lower-case names the hop never carries.
 * @returns Header record for the hop.
 */
function hopHeaders(
  previous: RequestInit['headers'],
  session: ISessionHeaders,
  dropped: readonly string[],
): Record<string, string> {
  const headers = replaceSessionHeaders(previous, session);
  for (const name of dropped) headers.delete(name);
  return Object.fromEntries(headers);
}

export default followedAfter;
export { droppedOnHop, followedAfter, hopHeaders, postStatusesOf };
