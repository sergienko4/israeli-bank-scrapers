/**
 * Redirect hop rules — what a manual hop may follow and what it never sends
 * (N2, N46), as the Fetch standard has them. An answer to a GET is followed on
 * 301/302/303/307/308. An answer to a POST is followed only under `postAsGet`
 * and only on 302/303, the statuses that turn a POST into a GET; its GET hop
 * drops the request-body headers. Once a run has crossed origins every hop
 * drops the credentials headers.
 */

import type { IManualRedirect } from '../../Types/Domain/FetchPolicy.js';
import type { HttpVerb } from './FetchStrategy.js';

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
 * @param verb - Verb of the request that redirected.
 * @param hasCrossed - Whether any hop so far changed origin.
 * @returns Lower-case names: the credentials once crossed, the body headers after a POST.
 */
function droppedOnHop(verb: HttpVerb, hasCrossed: boolean): readonly string[] {
  const credentials = hasCrossed ? CROSS_ORIGIN_DROPPED : [];
  const body = verb === 'GET' ? [] : BODY_HEADERS;
  return [...credentials, ...body];
}

export default followedAfter;
export { droppedOnHop, followedAfter, postStatusesOf };
