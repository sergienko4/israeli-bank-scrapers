/**
 * Response-header sink (N6, N31) — hands a call's sink the headers it
 * declared, read from the final response, and no others, with the
 * response's HTTP status. A declared header the response lacks is left
 * out; the caller decides what a missing one means. Header values are
 * never logged.
 */

import type { IResponseHeaderSink } from '../../Types/Domain/FetchPolicy.js';

/** One declared header and its value, when the response carried it. */
type HeaderRead = readonly [string, string | null];

/**
 * Hand the declared headers and the status of a response to the call's sink.
 * @param response - Final response of the call.
 * @param sink - The call's header sink, when it has one.
 * @returns How many headers the sink took (0 without a sink).
 */
function emitResponseHeaders(response: Response, sink?: IResponseHeaderSink): number {
  if (sink === undefined) return 0;
  const reads = sink.names.map((name): HeaderRead => [name, response.headers.get(name)]);
  const found = reads.filter((read): read is readonly [string, string] => read[1] !== null);
  const headers = Object.fromEntries(found);
  return sink.take(headers, response.status);
}

export default emitResponseHeaders;
export { emitResponseHeaders };
