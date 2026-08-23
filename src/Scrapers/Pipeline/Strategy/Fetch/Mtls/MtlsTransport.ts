/**
 * Mutual-TLS transport for hosts behind Cloudflare API Shield mTLS
 * (the OneZero identity + GraphQL hosts). globalThis.fetch cannot present a
 * client certificate, so this module performs the request over node:https with
 * an Agent carrying the client cert + key, then synthesises a Web Response so
 * the shared dispatchFetch pipeline (parsing, cookies, logging) is reused
 * unchanged. This is the ONLY node:https usage in the Pipeline by design.
 */

import type { ClientRequest, IncomingMessage } from 'node:http';
import { Agent, request as httpsRequest, type RequestOptions } from 'node:https';

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { toErrorMessage } from '../../../Types/ErrorUtils.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';
import type { FetchInvoke, HttpVerb } from '../NativeFetchStrategy.js';
import type { ICertBundle } from './OneZeroClientCert.js';

/**
 * Optional transport override used ONLY by the E2E-mocked suites. When set, the
 * mTLS invoke path delegates to this fallback (which routes through the mocked
 * `globalThis.fetch`) instead of opening a real node:https socket, so the
 * OneZero mocked pipeline runs fully offline. Production leaves this null,
 * keeping the node:https path byte-identical. Mirrors the setFakePageEvalMode
 * test seam already used by the mocked Camoufox layer.
 */
let mtlsFetchFallback: FetchInvoke | null = null;

/**
 * Install (or clear) the E2E-mocked transport fallback. Call with no argument
 * (or undefined) to clear it and restore the node:https path.
 * @param fallback - FetchInvoke to route mTLS requests through; omit to clear.
 * @returns True when a fallback is now active, false when cleared.
 */
function setMtlsFetchFallback(fallback?: FetchInvoke): boolean {
  mtlsFetchFallback = fallback ?? null;
  return mtlsFetchFallback !== null;
}

/** Fully-specified mTLS request bundle — keeps params under the 3-ceiling. */
interface IMtlsRequest {
  readonly agent: Agent;
  readonly url: string;
  readonly init: RequestInit;
  readonly verb: HttpVerb;
}

/**
 * Hard ceiling for a single mTLS request (connect + full response). A hung
 * Cloudflare socket would otherwise leave mtlsInvoke pending forever; the
 * AbortSignal.timeout aborts the request so the catch in mtlsInvoke surfaces a
 * network failure the Pipeline can retry/report instead of stalling.
 */
const MTLS_REQUEST_TIMEOUT_MS = 30_000;

/** Active per-request timeout (ms). Overridable for tuning + deterministic tests. */
let requestTimeoutMs: number = MTLS_REQUEST_TIMEOUT_MS;

/**
 * Override the per-request mTLS timeout (ms). Production keeps the default;
 * the mTLS test suites lower it to prove the abort path deterministically.
 * @param ms - New timeout in milliseconds.
 * @returns The timeout now in effect.
 */
function setMtlsRequestTimeoutMs(ms: number): number {
  requestTimeoutMs = ms;
  return requestTimeoutMs;
}

/**
 * Build a keep-alive-off HTTPS agent carrying the client cert + key.
 * @param bundle - Resolved PEM cert + key.
 * @returns An https.Agent that presents the client certificate on handshake.
 */
function buildMtlsAgent(bundle: ICertBundle): Agent {
  return new Agent({ cert: bundle.cert, key: bundle.key, keepAlive: false });
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

/**
 * Assemble node:https RequestOptions from the agent, init and verb.
 * @param agent - The mTLS agent.
 * @param init - Native fetch RequestInit (method/headers/body).
 * @param verb - HTTP verb.
 * @returns RequestOptions ready for https.request.
 */
function buildOptions(agent: Agent, init: RequestInit, verb: HttpVerb): RequestOptions {
  const headers = headersToRecord(init.headers);
  return { agent, method: verb, headers, signal: AbortSignal.timeout(requestTimeoutMs) };
}

/**
 * Write the request body when present (string bodies only — the Pipeline
 * always serialises JSON to a string before dispatch).
 * @param req - The active ClientRequest.
 * @param init - Native fetch RequestInit.
 * @returns True when a body was written, false otherwise.
 */
function writeBody(req: ClientRequest, init: RequestInit): boolean {
  const body = init.body;
  if (typeof body !== 'string') return false;
  req.write(body);
  return true;
}

/**
 * Issue the HTTPS request and resolve with the raw IncomingMessage.
 * @param request - The fully-specified mTLS request.
 * @returns Promise resolving with node's IncomingMessage (rejects on socket error).
 */
function sendRequest(request: IMtlsRequest): Promise<IncomingMessage> {
  const options = buildOptions(request.agent, request.init, request.verb);
  return new Promise((resolve, reject) => {
    const req = httpsRequest(request.url, options, resolve);
    req.on('error', reject);
    writeBody(req, request.init);
    req.end();
  });
}

/**
 * Buffer the full response body as a UTF-8 string. Rejects on a stream error or
 * a premature close (socket dropped mid-body) so a truncated Cloudflare response
 * surfaces as a network failure instead of a silently-empty body.
 * @param message - The response IncomingMessage.
 * @returns Promise resolving with the decoded body, or rejecting on stream error.
 */
function collectBody(message: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    message.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    message.on('end', () => {
      const buffer = Buffer.concat(chunks);
      const body = buffer.toString('utf8');
      resolve(body);
    });
    message.on('error', reject);
    message.on('close', () => {
      if (!message.readableEnded) reject(new Error('mtls response closed before end'));
    });
  });
}

/**
 * Flatten a node header value (string or string[]) to a single header string.
 * @param value - Raw node header value.
 * @returns Comma-joined string for array values, otherwise the value itself.
 */
function toHeaderValue(value: string | string[]): string {
  if (Array.isArray(value)) return value.join(', ');
  return value;
}

/**
 * Build the non-cookie header pairs from a node IncomingMessage.
 * Set-Cookie is excluded here and re-applied by appendSetCookies so that
 * Response.getSetCookie() works downstream.
 * @param message - The response IncomingMessage.
 * @returns Array of [name, value] header pairs (no set-cookie).
 */
function plainHeaderPairs(message: IncomingMessage): [string, string][] {
  const entries = Object.entries(message.headers);
  const nonCookie = entries.filter(entry => entry[0] !== 'set-cookie');
  return nonCookie.map((entry): [string, string] => [entry[0], toHeaderValue(entry[1] ?? '')]);
}

/**
 * Append each raw Set-Cookie line so Response.getSetCookie() returns them all.
 * @param headers - The Headers under construction.
 * @param cookies - Raw Set-Cookie lines from node.
 * @returns The same Headers instance, with cookies appended.
 */
function appendSetCookies(headers: Headers, cookies: string[]): Headers {
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return headers;
}

/**
 * Compose a Web Headers instance from a node IncomingMessage.
 * @param message - The response IncomingMessage.
 * @returns A Web Headers instance mirroring the node response headers.
 */
function buildResponseHeaders(message: IncomingMessage): Headers {
  const pairs = plainHeaderPairs(message);
  const headers = new Headers(pairs);
  const cookies = message.headers['set-cookie'] ?? [];
  return appendSetCookies(headers, cookies);
}

/**
 * Synthesise a Web Response from a node IncomingMessage + buffered body.
 * @param message - The response IncomingMessage (status + headers).
 * @param body - The decoded response body.
 * @returns A Web Response equivalent to what globalThis.fetch would yield.
 */
function toResponse(message: IncomingMessage, body: string): Response {
  const status = message.statusCode ?? 0;
  const headers = buildResponseHeaders(message);
  return new Response(body, { status, headers });
}

/**
 * Perform an mTLS request and surface a Procedure<Response>.
 * Mirrors invokeFetch's contract so it slots into dispatchFetch as the
 * transport seam; all response parsing and cookie handling stay shared.
 * @param request - The fully-specified mTLS request.
 * @returns Procedure carrying the synthesised Response, or a network failure.
 */
async function mtlsInvoke(request: IMtlsRequest): Promise<Procedure<Response>> {
  try {
    const message = await sendRequest(request);
    const body = await collectBody(message);
    const response = toResponse(message, body);
    return succeed(response);
  } catch (error) {
    const reason = toErrorMessage(error as Error);
    return fail(ScraperErrorTypes.Generic, `${request.verb} ${request.url} mtls error: ${reason}`);
  }
}

/**
 * Bind an mTLS agent into a FetchInvoke transport for a strategy's `_invoke`
 * seam. Keeps the arrow's typing local (typed const) so no inline arrow leaks
 * into the strategy subclasses.
 * @param agent - The mTLS agent to present on every request.
 * @returns A FetchInvoke that routes each request through the agent.
 */
function makeMtlsInvoke(agent: Agent): FetchInvoke {
  /**
   * Perform one request through the bound mTLS agent.
   * @param url - Fully-qualified target URL.
   * @param init - Native fetch RequestInit (method/headers/body).
   * @param verb - HTTP verb (for error-message prefixing).
   * @returns Procedure carrying the synthesised Response, or a network failure.
   */
  const invoke: FetchInvoke = (url, init, verb) => {
    if (mtlsFetchFallback) return mtlsFetchFallback(url, init, verb);
    return mtlsInvoke({ agent, url, init, verb });
  };
  return invoke;
}

export type { IMtlsRequest };
export type { HttpVerb } from '../NativeFetchStrategy.js';
export {
  buildMtlsAgent,
  collectBody,
  makeMtlsInvoke,
  MTLS_REQUEST_TIMEOUT_MS,
  mtlsInvoke,
  setMtlsFetchFallback,
  setMtlsRequestTimeoutMs,
  toResponse,
};
