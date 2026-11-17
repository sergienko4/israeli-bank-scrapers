/**
 * Request assembly and raw send for the mTLS transport.
 *
 * <p>Kept separate from {@link ./MtlsInvoke.ts} so the send path and the
 * fallback/timeout policy each stay under the function and file caps.
 */

import type { IncomingMessage } from 'node:http';
import { type Agent, request as httpsRequest, type RequestOptions } from 'node:https';

import type { IFetchInvokePolicy } from '../FetchStrategy.js';

/** Fully-specified mTLS request bundle — keeps params under the 3-ceiling. */
interface IMtlsRequest extends IFetchInvokePolicy {
  readonly agent: Agent;
  readonly url: string;
  readonly init: RequestInit;
}

/**
 * Normalise a fetch HeadersInit into a plain record for node:https.
 * @param headers - Optional fetch HeadersInit.
 * @returns Plain header record (empty when none supplied).
 */
function headersToRecord(headers?: HeadersInit): Record<string, string> {
  if (headers === undefined) return {};
  if (headers instanceof Headers) {
    const entries = headers.entries();
    return Object.fromEntries(entries);
  }
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

/** Headers that frame a body; the transport sets them from the bytes it sends. */
const FRAMING_HEADERS: ReadonlySet<string> = new Set(['content-length', 'transfer-encoding']);

/**
 * The request body's bytes (strings as UTF-8; byte arrays unchanged).
 * @param init - Native fetch RequestInit.
 * @returns The body bytes, or false when there is no supported body.
 */
function bodyBytes(init: RequestInit): Buffer | false {
  if (typeof init.body === 'string') return Buffer.from(init.body, 'utf8');
  if (init.body instanceof Uint8Array) return Buffer.from(init.body);
  return false;
}

/**
 * Request headers, with a body framed by its byte length in place of any
 * framing the caller named.
 * @param init - Native fetch RequestInit.
 * @param bytes - The body bytes, or false for no body.
 * @returns Plain header record for node:https.
 */
function framedHeaders(init: RequestInit, bytes: Buffer | false): Record<string, string> {
  const headers = headersToRecord(init.headers);
  if (bytes === false) return headers;
  const kept = Object.entries(headers).filter(([name]): boolean => {
    const lowered = name.toLowerCase();
    return !FRAMING_HEADERS.has(lowered);
  });
  return { ...Object.fromEntries(kept), 'content-length': String(bytes.byteLength) };
}

/**
 * Build the per-request timeout signal.
 * @param timeoutMs - Per-request timeout.
 * @returns The signal handed to node:https and body collection.
 */
function requestSignal(timeoutMs: number): AbortSignal {
  return AbortSignal.timeout(timeoutMs);
}

/**
 * Assemble node:https RequestOptions for one request.
 * @param request - The fully-specified mTLS request.
 * @param bytes - The body bytes, or false for no body.
 * @param signal - Per-request timeout signal.
 * @returns RequestOptions ready for https.request.
 */
function buildOptions(
  request: IMtlsRequest,
  bytes: Buffer | false,
  signal: AbortSignal,
): RequestOptions {
  const headers = framedHeaders(request.init, bytes);
  return { agent: request.agent, method: request.verb, headers, signal };
}

/**
 * End the request, sending the body bytes in one piece when there are any.
 * @param req - The active ClientRequest.
 * @param bytes - The body bytes, or false for no body.
 * @returns True when a body was sent, false otherwise.
 */
function endRequest(req: ReturnType<typeof httpsRequest>, bytes: Buffer | false): boolean {
  if (bytes === false) {
    req.end();
    return false;
  }
  req.end(bytes);
  return true;
}

/**
 * Issue the HTTPS request and resolve with the raw IncomingMessage.
 * @param request - The fully-specified mTLS request.
 * @param signal - Per-request timeout signal.
 * @returns Promise resolving with node's IncomingMessage (rejects on socket error).
 */
function sendRequest(request: IMtlsRequest, signal: AbortSignal): Promise<IncomingMessage> {
  const bytes = bodyBytes(request.init);
  const options = buildOptions(request, bytes, signal);
  return new Promise((resolve, reject) => {
    const req = httpsRequest(request.url, options, resolve);
    req.on('error', reject);
    endRequest(req, bytes);
  });
}

export type { IMtlsRequest };
export { requestSignal, sendRequest };
