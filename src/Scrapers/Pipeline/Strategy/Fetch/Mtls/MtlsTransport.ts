/**
 * Mutual-TLS transport for hosts behind Cloudflare API Shield mTLS
 * (the OneZero identity + GraphQL hosts). globalThis.fetch cannot present a
 * client certificate, so this module performs the request over node:https with
 * an Agent carrying the client cert + key, then synthesises a Web Response so
 * the shared dispatchFetch pipeline (parsing, cookies, logging) is reused
 * unchanged. The same Agent can also present a registered TLS ClientHello
 * profile (see TlsClientProfiles) for edges that fingerprint the handshake,
 * which globalThis.fetch cannot shape either. This is the ONLY module that
 * sends requests over node:https in the Pipeline by design. String and byte
 * bodies are sent once under `Content-Length` — never chunked.
 */

import type { ClientRequest, IncomingMessage } from 'node:http';
import { type Agent, request as httpsRequest, type RequestOptions } from 'node:https';

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { toError } from '../../../Types/ErrorUtils.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';
import type { FetchInvoke, IFetchInvokePolicy } from '../FetchStrategy.js';
import { isMediaTypeMismatch } from '../MediaTypeCheck.js';
import { isApiSuccess } from '../NativeFetchStrategy.js';
import { safeUrlForLog, scrubUrlFromText } from '../SafeUrlForLog.js';
import { checkServerCertificate } from '../Tls/ServerCertificateFloor.js';
import { SessionProtocolAgent } from '../Tls/SessionProtocolAgent.js';
import { getTlsClientProfile, type TlsClientProfileKind } from '../Tls/TlsClientProfiles.js';
import type { AgentSource, IPresentedCert } from './MtlsAgentSource.js';
import { collectBody, toResponse } from './MtlsResponse.js';
import type { ICertBundle } from './OneZeroClientCert.js';

/** One request handed to the mocked transport, with the certificate it would present. */
interface IMtlsFallbackRequest extends Omit<IMtlsRequest, 'agent'> {
  readonly presented: IPresentedCert | false;
}

/** The mocked transport an E2E-mocked suite installs. */
type MtlsFallback = (request: IMtlsFallbackRequest) => Promise<Procedure<Response>>;

/**
 * Optional transport override used ONLY by the E2E-mocked suites. When set, the
 * mTLS invoke path delegates to this fallback (which routes through the mocked
 * `globalThis.fetch`) instead of opening a real node:https socket, so the
 * OneZero mocked pipeline runs fully offline. Production leaves this null,
 * keeping the node:https path byte-identical. The fallback is told
 * which certificate the request would present (`false` for none), so a mocked
 * suite can prove a dynamic client certificate reaches its origin only.
 */
let mtlsFetchFallback: MtlsFallback | null = null;

/**
 * Install (or clear) the E2E-mocked transport fallback. Call with no argument
 * (or undefined) to clear it and restore the node:https path.
 * @param fallback - Transport to route mTLS requests through; omit to clear.
 * @returns True when a fallback is now active, false when cleared.
 */
function setMtlsFetchFallback(fallback?: MtlsFallback): boolean {
  mtlsFetchFallback = fallback ?? null;
  return mtlsFetchFallback !== null;
}

/** Fully-specified mTLS request bundle — keeps params under the 3-ceiling. */
interface IMtlsRequest extends IFetchInvokePolicy {
  readonly agent: Agent;
  readonly url: string;
  readonly init: RequestInit;
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
 * Selects the agent's client-certificate options.
 * @param clientCert - PEM cert + key to present, or false to present none.
 * @returns The cert + key options, or no options when no cert is presented.
 */
function toCertOptions(clientCert: ICertBundle | false): Partial<ICertBundle> {
  if (clientCert === false) return {};
  return { cert: clientCert.cert, key: clientCert.key };
}

/**
 * Builds the keep-alive-off HTTPS agent a node:https transport sends through.
 * The agent presents the optional client certificate and shapes its
 * ClientHello with the named profile; the default profile leaves Node's stock
 * handshake untouched. Every agent enforces the server-certificate floor and
 * the profile's session protocol, so a profile that lowers OpenSSL's security
 * level for its handshake cannot lower the bar for the server's chain or for
 * the handshake signature.
 * @param clientCert - PEM cert + key to present, or false to present none.
 * @param tlsProfile - Registered ClientHello profile to present.
 * @returns An https.Agent carrying the certificate and profile options.
 */
function buildMtlsAgent(
  clientCert: ICertBundle | false,
  tlsProfile: TlsClientProfileKind = 'node-default',
): Agent {
  const { options, sessionProtocol } = getTlsClientProfile(tlsProfile);
  const certOptions = toCertOptions(clientCert);
  const checkServerIdentity = checkServerCertificate;
  const agentOptions = { ...options, ...certOptions, checkServerIdentity, keepAlive: false };
  return new SessionProtocolAgent(agentOptions, sessionProtocol);
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
 * Assemble node:https RequestOptions for one request.
 * @param request - The fully-specified mTLS request.
 * @param bytes - The body bytes, or false for no body.
 * @returns RequestOptions ready for https.request.
 */
function buildOptions(request: IMtlsRequest, bytes: Buffer | false): RequestOptions {
  const headers = framedHeaders(request.init, bytes);
  const signal = AbortSignal.timeout(requestTimeoutMs);
  return { agent: request.agent, method: request.verb, headers, signal };
}

/**
 * End the request, sending the body bytes in one piece when there are any.
 * @param req - The active ClientRequest.
 * @param bytes - The body bytes, or false for no body.
 * @returns True when a body was sent, false otherwise.
 */
function endRequest(req: ClientRequest, bytes: Buffer | false): boolean {
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
 * @returns Promise resolving with node's IncomingMessage (rejects on socket error).
 */
function sendRequest(request: IMtlsRequest): Promise<IncomingMessage> {
  const bytes = bodyBytes(request.init);
  const options = buildOptions(request, bytes);
  return new Promise((resolve, reject) => {
    const req = httpsRequest(request.url, options, resolve);
    req.on('error', reject);
    endRequest(req, bytes);
  });
}

/**
 * Wrap a thrown mTLS error into a failure naming origin + path only.
 * @param error - The caught value, from any realm.
 * @param request - The request that failed.
 * @returns Procedure failure with no query string, even one the error quotes.
 */
function toMtlsFailure(error: unknown, request: IMtlsRequest): Procedure<Response> {
  const rawReason = toError(error).message;
  const reason = scrubUrlFromText(rawReason, request.url, request.redactUrlValues);
  const safeUrl = safeUrlForLog(request.url, request.redactUrlValues);
  return fail(ScraperErrorTypes.Generic, `${request.verb} ${safeUrl} mtls error: ${reason}`);
}

/**
 * Stop at mismatched API headers; the shared router retains status/WAF precedence.
 * @param message - The received status, headers and unread body.
 * @param mediaType - Expected media type, when one is named.
 * @returns Header-only mismatch response, otherwise the buffered response.
 */
async function readMtlsResponse(message: IncomingMessage, mediaType?: string): Promise<Response> {
  const empty = Buffer.alloc(0);
  const response = toResponse(message, empty);
  if (isApiSuccess(response) && isMediaTypeMismatch(response, mediaType)) {
    message.destroy();
    return response;
  }
  const body = await collectBody(message);
  return toResponse(message, body);
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
    const response = await readMtlsResponse(message, request.mediaType);
    return succeed(response);
  } catch (error) {
    return toMtlsFailure(error, request);
  }
}

/**
 * Send one resolved request through the active transport.
 * @param request - The request and the agent picked for it.
 * @param presented - The certificate the agent presents.
 * @returns Procedure carrying the synthesised Response, or a network failure.
 */
function invokeThrough(
  request: IMtlsRequest,
  presented: IPresentedCert | false,
): Promise<Procedure<Response>> {
  const { url, init, verb, mediaType, redactUrlValues } = request;
  if (mtlsFetchFallback) {
    return mtlsFetchFallback({ url, init, verb, mediaType, redactUrlValues, presented });
  }
  return mtlsInvoke(request);
}

/**
 * Bind an agent source into a FetchInvoke transport for a strategy's `_invoke`
 * seam. The source is asked on every request, so a dynamic client certificate
 * installed mid-run applies to the next request. Keeps the arrow's typing
 * local (typed const) so no inline arrow leaks into the strategy subclasses.
 * @param source - Picks the mTLS agent for each request URL.
 * @returns A FetchInvoke that routes each request through the picked agent.
 */
function makeMtlsInvoke(source: AgentSource): FetchInvoke {
  /**
   * Perform one request through the agent the source picks.
   *
   * <p>`url` and `init` stay authoritative: a redirect-reject hop passes its
   * whole run object as `policy`, so spreading that object last would restore
   * the pre-hop URL and drop the caller's `redirect: 'manual'` override.
   *
   * @param url - Fully-qualified target URL.
   * @param init - Native fetch RequestInit (method/headers/body).
   * @param policy - HTTP verb and expected response media type.
   * @returns Procedure carrying the synthesised Response, or a network failure.
   */
  const invoke: FetchInvoke = (url, init, policy) => {
    const { verb, mediaType, redactUrlValues } = policy;
    const choice = source(url);
    const request = { agent: choice.agent, url, init, verb, mediaType, redactUrlValues };
    return invokeThrough(request, choice.presented);
  };
  return invoke;
}

export type { IMtlsFallbackRequest, IMtlsRequest, MtlsFallback };
export type { HttpVerb } from '../NativeFetchStrategy.js';
export {
  buildMtlsAgent,
  makeMtlsInvoke,
  MTLS_REQUEST_TIMEOUT_MS,
  mtlsInvoke,
  setMtlsFetchFallback,
  setMtlsRequestTimeoutMs,
};
