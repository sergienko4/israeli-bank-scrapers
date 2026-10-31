/**
 * Mutual-TLS transport for hosts behind Cloudflare API Shield mTLS
 * (the OneZero identity + GraphQL hosts). globalThis.fetch cannot present a
 * client certificate, so this module performs the request over node:https with
 * an Agent carrying the client cert + key, then synthesises a Web Response so
 * the shared dispatchFetch pipeline (parsing, cookies, logging) is reused
 * unchanged. The same Agent can also present a registered TLS ClientHello
 * profile (see TlsClientProfiles) for edges that fingerprint the handshake,
 * which globalThis.fetch cannot shape either. This is the ONLY module that
 * sends requests over node:https in the Pipeline by design.
 */

import type { ClientRequest, IncomingMessage } from 'node:http';
import { type Agent, request as httpsRequest, type RequestOptions } from 'node:https';

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { toError } from '../../../Types/ErrorUtils.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';
import type { FetchInvoke, HttpVerb } from '../NativeFetchStrategy.js';
import { safeUrlForLog, scrubUrlFromText } from '../SafeUrlForLog.js';
import { checkServerCertificate } from '../Tls/ServerCertificateFloor.js';
import { SessionProtocolAgent } from '../Tls/SessionProtocolAgent.js';
import { getTlsClientProfile, type TlsClientProfileKind } from '../Tls/TlsClientProfiles.js';
import { collectBody, toResponse } from './MtlsResponse.js';
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
 * Wrap a thrown mTLS error into a failure naming origin + path only.
 * @param error - The caught value, from any realm.
 * @param request - The request that failed.
 * @returns Procedure failure with no query string, even one the error quotes.
 */
function toMtlsFailure(error: unknown, request: IMtlsRequest): Procedure<Response> {
  const rawReason = toError(error).message;
  const reason = scrubUrlFromText(rawReason, request.url);
  const safeUrl = safeUrlForLog(request.url);
  return fail(ScraperErrorTypes.Generic, `${request.verb} ${safeUrl} mtls error: ${reason}`);
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
    return toMtlsFailure(error, request);
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
  makeMtlsInvoke,
  MTLS_REQUEST_TIMEOUT_MS,
  mtlsInvoke,
  setMtlsFetchFallback,
  setMtlsRequestTimeoutMs,
};
