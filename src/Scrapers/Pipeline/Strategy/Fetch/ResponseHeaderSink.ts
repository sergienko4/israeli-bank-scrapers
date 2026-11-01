/**
 * Response-header sink (N6, N31, N51) — hands a call's sink the headers it
 * declared, read from the final response, and no others, with the
 * response's HTTP status and the URL that gave it. A declared header the
 * response lacks is left out; the caller decides what a missing one means.
 * Header values and the URL are never logged.
 */

import type { IResponseHeaderSink } from '../../Types/Domain/FetchPolicy.js';

/** One declared header and its value, when the response carried it. */
type HeaderRead = readonly [string, string | null];

/**
 * The declared headers a response carried, by their lower-case names.
 * @param response - Final response of the call.
 * @param names - The declared header names.
 * @returns Each declared header the response carried, with its value.
 */
function declaredHeaders(response: Response, names: readonly string[]): Record<string, string> {
  const reads = names.map((name): HeaderRead => [name, response.headers.get(name)]);
  const found = reads.filter((read): read is readonly [string, string] => read[1] !== null);
  return Object.fromEntries(found);
}

/**
 * Hand the declared headers, the status and the URL of a response to the
 * call's sink.
 * @param response - Final response of the call.
 * @param responseUrl - The URL that gave it.
 * @param sink - The call's header sink, when it has one.
 * @returns How many headers the sink took (0 without a sink).
 */
function emitResponseHeaders(
  response: Response,
  responseUrl: string,
  sink?: IResponseHeaderSink,
): number {
  if (sink === undefined) return 0;
  const headers = declaredHeaders(response, sink.names);
  return sink.take(headers, response.status, responseUrl);
}

export default emitResponseHeaders;
export { emitResponseHeaders };
