/**
 * Transport helpers for ApiMediator: URL query assembly, header merging,
 * GraphQL envelope unwrap, and the firePost/fireGet/fireQuery primitives.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { PostData } from '../../Strategy/Fetch/FetchStrategy.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';
import type {
  IFireGetArgs,
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
 * Matches the operation name in `query X`, `mutation X`, `subscription X`.
 */
const OPERATION_NAME_RE = /\b(?:query|mutation|subscription)\s+([A-Za-z_]\w*)/u;

/**
 * Matches the spans of a GraphQL document that are not executable code:
 * `#` line comments, `"""block strings"""` and `"string literals"`.
 *
 * <p>Block strings are listed before plain strings so a `"""` opener is
 * never mis-read as an empty `""` literal.
 */
const NON_CODE_RE = /#[^\n]*|"""[\s\S]*?"""|"(?:[^"\\\n]|\\.)*"/gu;

/**
 * Blank out every non-executable span of a GraphQL document.
 *
 * <p>Prose is free to mention `query Something`; without this filter such
 * a mention would be picked up as the document's operation name and would
 * mislabel the failing call.
 * @param queryString - Raw GraphQL document.
 * @returns Document with comments and string literals replaced by a space.
 */
function stripNonCode(queryString: string): string {
  return queryString.replaceAll(NON_CODE_RE, ' ');
}

/**
 * Extract the GraphQL operation name from a query document.
 *
 * <p>Anonymous documents (`{ field }`) carry no name, so the caller omits the
 * label and the long-standing message stays byte-identical. Names mentioned
 * only inside a comment or a string literal do not count as a definition.
 * @param queryString - Raw GraphQL document sent to the bank.
 * @returns Operation name, or '' when the document is anonymous.
 */
function operationName(queryString: string): string {
  const executable = stripNonCode(queryString);
  const match = OPERATION_NAME_RE.exec(executable);
  if (match === null) return '';
  return match[1];
}

/**
 * Build the ` [Operation]` segment naming the failing GraphQL call.
 *
 * <p>Banks surface their own upstream faults inside the envelope (an opaque
 * `Request failed with status code 500`), which alone cannot say WHICH read
 * failed. Naming the operation makes the failure traceable to one stage.
 * @param operation - Operation name ('' when anonymous).
 * @returns ` [Name]` or '' when there is no name.
 */
function operationLabel(operation: string): string {
  if (operation.length === 0) return '';
  return ` [${operation}]`;
}

/**
 * Fail-helper for GraphQL envelopes with non-empty error list.
 * @param label - First error message label.
 * @param operation - GraphQL operation name ('' when anonymous).
 * @returns Procedure failure.
 */
function envelopeErrorFail<T>(label: string, operation: string): Procedure<T> {
  const at = operationLabel(operation);
  return fail(ScraperErrorTypes.Generic, `graphql errors${at}: ${label}`);
}

/**
 * Fail-helper for GraphQL envelopes whose `data` field is undefined.
 * @param operation - GraphQL operation name ('' when anonymous).
 * @returns Procedure failure.
 */
function envelopeMissingDataFail<T>(operation: string): Procedure<T> {
  const at = operationLabel(operation);
  return fail(ScraperErrorTypes.Generic, `graphql response${at} missing data`);
}

/**
 * Unwrap a GraphQL envelope to a Procedure payload.
 * @param envelope - Raw GraphQL response object.
 * @param operation - GraphQL operation name ('' when anonymous).
 * @returns Procedure with unwrapped data.
 */
function unwrapGraphql<T>(envelope: IGraphQLEnvelope<T>, operation: string): Procedure<T> {
  const errors = envelope.errors ?? [];
  const errorLabel = firstErrorMessage(errors);
  if (errorLabel.length > 0) return envelopeErrorFail<T>(errorLabel, operation);
  if (envelope.data === undefined) return envelopeMissingDataFail<T>(operation);
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
 * @param args - Bundled fireGet arguments (deps + url + auth + extras).
 * @returns Typed Procedure from the transport.
 */
async function fireGet<T>(args: IFireGetArgs): Promise<Procedure<T>> {
  const extraHeaders = mergeHeaders(args.rawAuth, args.extraHeaders);
  return args.deps.fetchStrategy.fetchGet<T>(args.url, { extraHeaders });
}

/**
 * Send the GraphQL document and return the raw envelope procedure.
 * @param args - Bundled fireQuery arguments.
 * @returns Procedure carrying the raw GraphQL envelope.
 */
async function sendQuery<T>(args: IFireQueryArgs): Promise<Procedure<IGraphQLEnvelope<T>>> {
  const extraHeaders = mergeHeaders(args.rawAuth, args.extraHeaders);
  const opts = { extraHeaders };
  const { queryString, variables } = args;
  return args.deps.graphqlStrategy.query<IGraphQLEnvelope<T>>(queryString, variables, opts);
}

/**
 * Execute apiQuery after query-string resolution has succeeded.
 * @param args - Bundled fireQuery arguments.
 * @returns Unwrapped Procedure with the GraphQL data payload.
 */
async function fireQuery<T>(args: IFireQueryArgs): Promise<Procedure<T>> {
  const envelopeProc = await sendQuery<T>(args);
  if (!isOk(envelopeProc)) return envelopeProc;
  const operation = operationName(args.queryString);
  return unwrapGraphql<T>(envelopeProc.value, operation);
}

export { appendQuery, buildHeaders, fireGet, firePost, fireQuery, mergeHeaders, NO_EXTRA_HEADERS };
