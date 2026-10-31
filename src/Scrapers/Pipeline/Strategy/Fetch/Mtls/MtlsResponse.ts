/**
 * Response side of the node:https transport: buffers an IncomingMessage body
 * and synthesises the Web Response the shared dispatchFetch pipeline parses.
 * Split from MtlsTransport so the request side stays under the file cap.
 */

import type { IncomingMessage } from 'node:http';

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

export { collectBody, toResponse };
