/**
 * Transport helpers for ApiMediator: URL query assembly, header merging,
 * GraphQL envelope unwrap, and the firePost/fireGet/fireQuery primitives.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { PostData } from '../../Strategy/Fetch/FetchStrategy.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';
import type {
  IApiMediatorDeps,
  IFirePostArgs,
  IFireQueryArgs,
  IGraphQLEnvelope,
  IGraphQLError,
} from './ApiMediator.types.js';

/** Empty header map — shared singleton for callers with no extras. */
const NO_EXTRA_HEADERS: Record<string, string> = Object.freeze({});

/**
 * Append query parameters to a URL preserving any existing querystring.
 * @param url - Resolved URL.
 * @param query - Additional key→value pairs to append.
 * @returns URL with merged querystring.
 */
function appendQuery(url: string, query: Record<string, string>): string {
  const keys = Object.keys(query);
  if (keys.length === 0) return url;
  const parts = keys.map((k): string => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`);
  const joined = parts.join('&');
  if (url.includes('?')) return `${url}&${joined}`;
  return `${url}?${joined}`;
}

/**
 * Build the outbound headers map with the currently stored Authorization value.
 * @param rawAuth - Full authorization header value (empty when unset).
 * @returns Header map including Authorization when rawAuth is non-empty.
 */
function buildHeaders(rawAuth: string): Record<string, string> {
  if (rawAuth === '') return {};
  return { authorization: rawAuth };
}

/**
 * Merge per-call extraHeaders with the stored Authorization header.
 * @param rawAuth - Current auth header value (empty when unset).
 * @param extra - Per-call headers supplied by the caller.
 * @returns Combined header map.
 */
function mergeHeaders(rawAuth: string, extra: Record<string, string>): Record<string, string> {
  return { ...extra, ...buildHeaders(rawAuth) };
}

/**
 * Convert an arbitrary body to the transport's PostData shape.
 * @param body - Caller-supplied body.
 * @returns Body typed for the fetch strategy.
 */
function toPostData(body: Record<string, unknown>): PostData {
  return body as PostData;
}

/**
 * Extract the first GraphQL error message, or the fallback label when absent.
 * @param errors - Error list from the envelope (empty when absent).
 * @returns Message string ('' only when errors list is empty).
 */
function firstErrorMessage(errors: readonly IGraphQLError[]): string {
  if (errors.length === 0) return '';
  const message = errors[0].message;
  if (typeof message === 'string' && message.length > 0) return message;
  return '<unknown>';
}

/**
 * Fail-helper for GraphQL envelopes with non-empty error list.
 * @param label - First error message label.
 * @returns Procedure failure.
 */
function envelopeErrorFail<T>(label: string): Procedure<T> {
  return fail(ScraperErrorTypes.Generic, `graphql errors: ${label}`);
}

/**
 * Fail-helper for GraphQL envelopes whose `data` field is undefined.
 * @returns Procedure failure.
 */
function envelopeMissingDataFail<T>(): Procedure<T> {
  return fail(ScraperErrorTypes.Generic, 'graphql response missing data');
}

/**
 * Unwrap a GraphQL envelope to a Procedure payload.
 * @param envelope - Raw GraphQL response object.
 * @returns Procedure with unwrapped data.
 */
function unwrapGraphql<T>(envelope: IGraphQLEnvelope<T>): Procedure<T> {
  const errors = envelope.errors ?? [];
  const errorLabel = firstErrorMessage(errors);
  if (errorLabel.length > 0) return envelopeErrorFail<T>(errorLabel);
  if (envelope.data === undefined) return envelopeMissingDataFail<T>();
  return succeed(envelope.data);
}

/**
 * Execute apiPost after URL resolution has succeeded.
 * @param args - Bundled firePost arguments.
 * @returns Typed Procedure from the transport.
 */
async function firePost<T>(args: IFirePostArgs): Promise<Procedure<T>> {
  const headers = mergeHeaders(args.rawAuth, args.extraHeaders);
  const payload = toPostData(args.body);
  const finalUrl = appendQuery(args.url, args.query);
  const fetchOpts = { extraHeaders: headers, onSetCookie: args.onSetCookie };
  return args.deps.fetchStrategy.fetchPost<T>(finalUrl, payload, fetchOpts);
}

/**
 * Execute apiGet after URL resolution has succeeded.
 * @param deps - Bundled collaborators.
 * @param url - Resolved URL.
 * @param rawAuth - Current Authorization header value.
 * @returns Typed Procedure from the transport.
 */
async function fireGet<T>(
  deps: IApiMediatorDeps,
  url: string,
  rawAuth: string,
): Promise<Procedure<T>> {
  const extraHeaders = buildHeaders(rawAuth);
  return deps.fetchStrategy.fetchGet<T>(url, { extraHeaders });
}

/**
 * Execute apiQuery after query-string resolution has succeeded.
 * @param args - Bundled fireQuery arguments.
 * @returns Unwrapped Procedure with the GraphQL data payload.
 */
async function fireQuery<T>(args: IFireQueryArgs): Promise<Procedure<T>> {
  const extraHeaders = mergeHeaders(args.rawAuth, args.extraHeaders);
  const envelopeProc = await args.deps.graphqlStrategy.query<IGraphQLEnvelope<T>>(
    args.queryString,
    args.variables,
    { extraHeaders },
  );
  if (!isOk(envelopeProc)) return envelopeProc;
  return unwrapGraphql<T>(envelopeProc.value);
}

export { appendQuery, buildHeaders, fireGet, firePost, fireQuery, mergeHeaders, NO_EXTRA_HEADERS };
