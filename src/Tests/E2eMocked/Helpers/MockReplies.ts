/**
 * Synthetic reply builders and cookie checks shared by the HTTP-only bank
 * fetch mocks: a body, a bodiless status, JSON, a 302, and the Cookie header
 * a recorded call sent.
 */

import type {
  JsonUnknownList,
  JsonUnknownRecord,
} from '../../../Scrapers/Pipeline/Types/JsonValue.js';
import type { IRecordedCall } from './FetchMockKit.js';

/** What a reply carries besides its status and body. */
export interface IReplyExtras {
  readonly setCookies?: readonly string[];
  readonly headers?: Readonly<Record<string, string>>;
}

/** A JSON body: an object, or a top-level array. */
export type JsonReplyBody = JsonUnknownRecord | JsonUnknownList;

/**
 * The headers a synthetic reply carries.
 * @param extras - Set-Cookie lines and headers.
 * @returns The response headers.
 */
function headersOf(extras: IReplyExtras): Headers {
  const headers = new Headers(extras.headers);
  for (const line of extras.setCookies ?? []) headers.append('set-cookie', line);
  return headers;
}

/**
 * A synthetic reply with a body.
 * @param status - HTTP status.
 * @param body - Body text.
 * @param extras - Set-Cookie lines and headers.
 * @returns The response.
 */
export function reply(status: number, body: string, extras: IReplyExtras = {}): Response {
  const headers = headersOf(extras);
  return new Response(body, { status, headers });
}

/**
 * A synthetic reply with no body (a redirect or a 204).
 * @param status - HTTP status.
 * @param extras - Set-Cookie lines and headers.
 * @returns The response.
 */
export function bodiless(status: number, extras: IReplyExtras = {}): Response {
  const headers = headersOf(extras);
  return new Response(null, { status, headers });
}

/**
 * A 200 JSON reply.
 * @param payload - JSON body.
 * @param extras - Set-Cookie lines and headers.
 * @returns The response.
 */
export function json(payload: JsonReplyBody, extras: IReplyExtras = {}): Response {
  const headers = { 'content-type': 'application/json', ...extras.headers };
  const text = JSON.stringify(payload);
  return reply(200, text, { ...extras, headers });
}

/**
 * A 302 to a location.
 * @param location - Location header value.
 * @param setCookies - Set-Cookie lines the hop sets.
 * @returns The response.
 */
export function redirectTo(location: string, setCookies: readonly string[] = []): Response {
  return bodiless(302, { headers: { location }, setCookies });
}

/**
 * The cookie pairs a call sent.
 * @param call - The recorded request.
 * @returns Each `name=value` pair of its Cookie header.
 */
export function cookiesOf(call: IRecordedCall): readonly string[] {
  return (call.headers.get('cookie') ?? '').split('; ');
}

/**
 * Whether a call sent every pair.
 * @param call - The recorded request.
 * @param pairs - `name=value` pairs to look for.
 * @returns True when the Cookie header holds all of them.
 */
export function hasCookies(call: IRecordedCall, pairs: readonly string[]): boolean {
  const sent = cookiesOf(call);
  return pairs.every(pair => sent.includes(pair));
}
