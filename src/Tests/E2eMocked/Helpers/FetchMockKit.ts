/**
 * Fetch-mock kit — the plumbing every browserless bank mock shares. It swaps
 * `globalThis.fetch` for a server, records each request as the server saw
 * it, tallies login against data calls and restores fetch on dispose.
 *
 * A bank mock supplies only its protocol: how a call is classified and how
 * it is answered.
 */

import type { JsonUnknownRecord } from '../../../Scrapers/Pipeline/Types/JsonValue.js';

/** Tally values returned alongside dispose for wiring assertions. */
export interface IMockCallCounts {
  readonly identity: number;
  readonly graphql: number;
}

/** One request the pipeline sent, as the server saw it. */
export interface IRecordedCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: string;
}

/** Installer handle — `dispose()` restores the original fetch. */
export interface IMockHandle {
  readonly dispose: () => boolean;
  readonly callCounts: () => IMockCallCounts;
  readonly calls: () => readonly IRecordedCall[];
}

/** The tally a call counts toward; `other` counts toward neither. */
export type CallKind = keyof IMockCallCounts | 'other';

/** The protocol a bank mock plugs into the kit. */
export interface IMockServer {
  readonly classify: (call: IRecordedCall) => CallKind;
  readonly answer: (call: IRecordedCall) => Promise<Response>;
}

/** A transport-level failure a login call can answer with. */
export type NetworkFault = 'http500' | 'reject' | 'nonJson' | 'timeout';

/**
 * A JSON 200 response.
 * @param payload - Body to serialise.
 * @param setCookie - Set-Cookie line the server sends with it; empty for none.
 * @returns A real Response carrying the JSON.
 */
export function jsonReply(payload: JsonUnknownRecord, setCookie = ''): Response {
  const bodyText = JSON.stringify(payload);
  const headers = new Headers({ 'content-type': 'application/json' });
  if (setCookie !== '') headers.append('set-cookie', setCookie);
  return new Response(bodyText, { status: 200, headers });
}

/**
 * A non-2xx response with a plain-text body.
 * @param status - HTTP status.
 * @returns A real Response with that status.
 */
export function errorReply(status: number): Response {
  return new Response(`synthetic ${String(status)}`, { status });
}

/**
 * Parse a JSON request body.
 * @param body - Raw request body.
 * @returns The parsed object, or an empty one when the body is not JSON.
 */
export function parseBody(body: string): JsonUnknownRecord {
  try {
    return JSON.parse(body) as JsonUnknownRecord;
  } catch {
    return {};
  }
}

/**
 * Parse a form-encoded request body.
 * @param body - Raw `application/x-www-form-urlencoded` body.
 * @returns Each decoded field; a repeated name keeps its last value.
 */
export function parseForm(body: string): Readonly<Record<string, string>> {
  const fields = new URLSearchParams(body);
  return Object.fromEntries(fields);
}

/** How a login call misbehaves under each transport fault. */
export const NETWORK_FAULTS: Readonly<Record<NetworkFault, () => Promise<Response>>> = {
  /**
   * The gateway failed.
   * @returns A 500.
   */
  http500: (): Promise<Response> => {
    const reply = errorReply(500);
    return Promise.resolve(reply);
  },
  /**
   * The network dropped the request.
   * @returns A rejection, as fetch gives.
   */
  reject: (): Promise<Response> => Promise.reject(new TypeError('fetch failed')),
  /**
   * A maintenance page served as 200.
   * @returns A 200 whose body is not JSON.
   */
  nonJson: (): Promise<Response> =>
    Promise.resolve(new Response('<html>synthetic maintenance</html>', { status: 200 })),
  /**
   * The request ran past the transport's deadline.
   * @returns The rejection an expired AbortSignal gives.
   */
  timeout: (): Promise<Response> =>
    Promise.reject(new DOMException('The operation timed out.', 'TimeoutError')),
};

/** First argument accepted by globalThis.fetch. */
type FetchInput = string | Request | URL;

/** Mutable tallies one installed mock keeps. */
interface IKitState {
  readonly log: IRecordedCall[];
  identity: number;
  graphql: number;
}

/**
 * Normalise a fetch input into its URL string.
 * @param input - First argument passed to fetch().
 * @returns The URL.
 */
function toUrlString(input: FetchInput): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/**
 * Read the request body as the mock bank receives it.
 * @param body - Fetch body, possibly the UTF-8 bytes of a text POST.
 * @returns Wire text, or empty for a bodyless request.
 */
function bodyText(body: RequestInit['body']): string {
  if (body === undefined || body === null) return '';
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return new TextDecoder('utf-8', { fatal: true }).decode(body);
  throw new TypeError('unsupported mocked request body');
}

/**
 * Capture a request as the server sees it.
 * @param input - First argument passed to fetch().
 * @param init - Fetch init.
 * @returns The recorded call.
 */
function recordCall(input: FetchInput, init?: RequestInit): IRecordedCall {
  const url = toUrlString(input);
  const method = init?.method ?? 'GET';
  const headers = new Headers(init?.headers);
  const body = bodyText(init?.body);
  return { url, method, headers, body };
}

/**
 * Log a call and add it to its tally.
 * @param state - Kit state, updated in place.
 * @param call - The recorded call.
 * @param kind - Tally the server classified it into.
 * @returns True once logged.
 */
function logCall(state: IKitState, call: IRecordedCall, kind: CallKind): boolean {
  state.log.push(call);
  if (kind !== 'other') state[kind] += 1;
  return true;
}

/**
 * Build the fetch replacement over one server.
 * @param server - Protocol that classifies and answers each call.
 * @param state - Kit state the calls are logged and tallied in.
 * @returns A function with fetch's signature.
 */
function makeMockFetch(server: IMockServer, state: IKitState): typeof fetch {
  return (input: FetchInput, init?: RequestInit): Promise<Response> => {
    const call = recordCall(input, init);
    const kind = server.classify(call);
    logCall(state, call, kind);
    return server.answer(call);
  };
}

/**
 * Install a mock server over globalThis.fetch.
 * @param server - Protocol that classifies and answers each call.
 * @returns Handle with dispose, call counts and the call log.
 */
export function installFetchMock(server: IMockServer): IMockHandle {
  const previousFetch = globalThis.fetch;
  const state: IKitState = { log: [], identity: 0, graphql: 0 };
  globalThis.fetch = makeMockFetch(server, state);
  return {
    /**
     * Restore the original fetch.
     * @returns True once restored.
     */
    dispose: (): boolean => {
      globalThis.fetch = previousFetch;
      return true;
    },
    /**
     * Snapshot the identity and data-call tallies.
     * @returns Immutable counts.
     */
    callCounts: (): IMockCallCounts => ({ identity: state.identity, graphql: state.graphql }),
    /**
     * Every request sent so far, in order.
     * @returns The call log.
     */
    calls: (): readonly IRecordedCall[] => [...state.log],
  };
}
