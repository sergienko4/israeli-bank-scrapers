/**
 * Response side of the node:https transport: buffers an IncomingMessage body
 * and synthesises the Web Response the shared dispatchFetch pipeline parses.
 * Split from MtlsTransport so the request side stays under the file cap. The
 * buffer is capped (N34): a body past MTLS_MAX_RESPONSE_BYTES destroys the
 * stream and fails `response too large`.
 */

import type { IncomingMessage } from 'node:http';

/** Largest response body the node:https transport buffers, in bytes (8 MiB). */
const MTLS_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/** Fixed reason a response past the cap fails with. */
const RESPONSE_TOO_LARGE_REASON = 'response too large';

/** HTTP statuses whose Web Response must have a null body. */
const NO_BODY_STATUSES: ReadonlySet<number> = new Set([204, 205, 304]);

/** Settles a body collection with a failure. */
type BodyReject = (reason: Error) => unknown;

/**
 * Refuse a body past the cap: fail the collection, then destroy the stream so
 * no more of it is read.
 * @param message - The response IncomingMessage.
 * @param reject - The collection's reject.
 * @returns True once the stream is destroyed.
 */
function refuseOversize(message: IncomingMessage, reject: BodyReject): boolean {
  reject(new Error(RESPONSE_TOO_LARGE_REASON));
  message.destroy();
  return true;
}

/**
 * Buffer the full response body without decoding it. Rejects on a stream error or
 * a premature close (socket dropped mid-body) so a truncated Cloudflare response
 * surfaces as a network failure instead of a silently-empty body, and rejects
 * `response too large` once the body passes MTLS_MAX_RESPONSE_BYTES.
 * @param message - The response IncomingMessage.
 * @returns Raw body bytes, or a stream failure.
 */
function collectBody(message: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    message.on('data', (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > MTLS_MAX_RESPONSE_BYTES) return refuseOversize(message, reject);
      chunks.push(chunk);
      return true;
    });
    message.on('end', () => {
      const buffer = Buffer.concat(chunks);
      resolve(buffer);
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
 * @param body - The response body bytes, still undecoded.
 * @returns A Web Response equivalent to what globalThis.fetch would yield.
 */
function toResponse(message: IncomingMessage, body: Buffer): Response {
  const status = message.statusCode ?? 0;
  const headers = buildResponseHeaders(message);
  const responseBody = NO_BODY_STATUSES.has(status) ? null : new Uint8Array(body);
  return new Response(responseBody, { status, headers });
}

export { collectBody, MTLS_MAX_RESPONSE_BYTES, RESPONSE_TOO_LARGE_REASON, toResponse };
