/**
 * Native fetch network seam — the raw `globalThis.fetch` call, its failure
 * mapping, URL resolution and the body-refusal message. Kept apart from the
 * strategy class so the transport seams and the dispatch pipeline each stay
 * inside their file cap.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { Brand } from '../../Types/Brand.js';
import { errorCauseCodeOf, toError } from '../../Types/ErrorUtils.js';
import type { IProcedureFailure, Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { FetchInvoke, HttpVerb } from './FetchStrategy.js';
import { safeUrlForLog, scrubUrlFromText } from './SafeUrlForLog.js';

/** A URL that already carries its scheme and host. */
type FullyQualifiedUrl = Brand<string, 'FullyQualifiedUrl'>;

/** The parts of a native request a failure message needs. */
interface INativeFailure {
  readonly url: string;
  readonly verb: HttpVerb;
  readonly redactUrlValues?: readonly string[];
}

/** One native request and the account ids its failure text must mask. */
interface INativeRequest extends INativeFailure {
  readonly init: RequestInit;
}

/** Reason for a header fetch refused; the refusal's own text may quote the value. */
const INVALID_HEADER_REASON = 'invalid request header';

/** Node/undici refusal texts naming a header fetch would not send. */
const HEADER_REFUSAL_PATTERN = /invalid header|ByteString/i;

/**
 * The reason a network failure reports: a header refusal by name only,
 * anything else with the URL scrubbed out.
 * @param rawReason - The thrown error's message.
 * @param request - The native request whose URL and ids are masked.
 * @returns The reason to report.
 */
function networkReason(rawReason: string, request: INativeFailure): string {
  if (HEADER_REFUSAL_PATTERN.test(rawReason)) return INVALID_HEADER_REASON;
  return scrubUrlFromText(rawReason, request.url, request.redactUrlValues);
}

/**
 * Wrap a thrown fetch error into a network-error Procedure.
 * @param error - The caught value, from any realm.
 * @param request - The native request that failed.
 * @returns Procedure failure annotated with the underlying reason.
 */
function toNetworkFailure(error: unknown, request: INativeFailure): Procedure<Response> {
  const rawReason = toError(error).message;
  const code = errorCauseCodeOf(error);
  const base = networkReason(rawReason, request);
  const reason = code === '' ? base : `${base} (${code})`;
  const safeUrl = safeUrlForLog(request.url, request.redactUrlValues);
  return fail(ScraperErrorTypes.Generic, `${request.verb} ${safeUrl} network error: ${reason}`);
}

/**
 * Run globalThis.fetch and surface the Response or a network-error Procedure.
 * @param request - URL, init, verb and explicit account ids to mask.
 * @returns Procedure carrying the raw Response, or a network-error failure.
 */
async function invokeFetch(request: INativeRequest): Promise<Procedure<Response>> {
  try {
    const response = await globalThis.fetch(request.url, request.init);
    return succeed(response);
  } catch (error) {
    return toNetworkFailure(error, request);
  }
}

/**
 * Adapt the native fetch caller to the transport policy seam.
 * @param url - Target URL.
 * @param init - Native fetch request.
 * @param policy - Request metadata; media checks stay in the shared router.
 * @returns The raw response or the native network failure.
 */
const INVOKE_NATIVE_FETCH: FetchInvoke = (url, init, policy): Promise<Procedure<Response>> =>
  invokeFetch({ url, init, verb: policy.verb, redactUrlValues: policy.redactUrlValues });

/**
 * Resolve a request URL the way every node transport does: an absolute
 * http(s) URL passes through, anything else is appended to the base URL.
 * @param baseUrl - The transport's base URL.
 * @param url - Caller-supplied URL (absolute or relative).
 * @returns The fully-qualified URL suitable for globalThis.fetch.
 */
function resolveFetchUrl(baseUrl: string, url: string): FullyQualifiedUrl {
  if (url.startsWith('http://') || url.startsWith('https://')) return url as FullyQualifiedUrl;
  return `${baseUrl}${url}` as FullyQualifiedUrl;
}

/**
 * Fail a POST whose body its writer refused, before any request.
 * @param url - Resolved request URL.
 * @param refusal - The writer's fixed refusal.
 * @param redactUrlValues - Explicit account ids to mask in the message.
 * @returns The refusal, naming the request URL only.
 */
function refuseBody<T>(
  url: string,
  refusal: IProcedureFailure,
  redactUrlValues?: readonly string[],
): Procedure<T> {
  const safeUrl = safeUrlForLog(url, redactUrlValues);
  return fail(refusal.errorType, `POST ${safeUrl} ${refusal.errorMessage}`);
}

export { INVOKE_NATIVE_FETCH, invokeFetch, refuseBody, resolveFetchUrl, toNetworkFailure };
export type { FullyQualifiedUrl };
