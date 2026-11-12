/**
 * Pepper synthetic fetch mock — intercepts globalThis.fetch for the
 * Pepper Transmit + GraphQL API so the pipeline can be exercised without
 * network. Rule #18: every value is SYNTHETIC (no real PII).
 *
 * Pepper runs on `nativeFetch: true`, so this override intercepts every
 * auth and GraphQL call through `globalThis.fetch`.
 *
 * Auth routes are served by the synthetic Transmit server in
 * `PepperAuthServer.ts`, which verifies every request signature. GraphQL
 * answers 401 to any bearer the server did not issue or the test did not
 * explicitly accept, so a stale or never-renewed token cannot slip through.
 */

import type { IAuthRouteCounts, IAuthServer, ISeedDevice } from './PepperAuthServer.js';
import { createPepperAuthServer, handleAuthRequest } from './PepperAuthServer.js';
import { headerOf } from './PepperSignatureOracle.js';

/** Tally values for wiring assertions. */
export interface IMockCallCounts extends Readonly<IAuthRouteCounts> {
  readonly identity: number;
  readonly graphql: number;
  readonly graphqlRejected: number;
  /** Rejection reasons, in order — pins *where* a request was refused. */
  readonly rejections: readonly string[];
}

/** Optional server behaviour; omitted fields keep the legacy defaults. */
export interface IPepperMockOptions {
  /** Access token the OTP / resume assertion returns. */
  readonly issuedToken?: string;
  /** Devices bound by an earlier (simulated) enrollment. */
  readonly devices?: readonly ISeedDevice[];
  /** Bearer tokens GraphQL accepts besides the issued one. */
  readonly acceptedTokens?: readonly string[];
}

/** Installer handle. */
export interface IMockHandle {
  readonly dispose: () => boolean;
  readonly callCounts: () => IMockCallCounts;
}

/** Synthetic credentials — safe for public fixtures. */
export const PEPPER_MOCK_CREDS = Object.freeze({
  phoneNumber: '972000000000',
  password: 'fixt-m-pep-9b1d',
  otpLongTermToken: 'syn-pepper-long-term-a7f4b2c8',
});

const SYN_JWT = 'syn-jwt-a7f4b2c8';
const SYN_ACCOUNT_ID = 'acct-pep-001';
const SYN_ACCOUNT_NUMBER = '40286139';
const SYN_CUSTOMER_ID = 'cust-pep-001';
const SYN_BALANCE = 2850.6;

type JsonObject = Record<string, unknown>;

/** Accumulates call counts. */
interface ICallTally {
  identity: number;
  graphql: number;
  graphqlRejected: number;
}

/** Everything one installed mock instance owns. */
interface IMockState {
  readonly tally: ICallTally;
  readonly server: IAuthServer;
  readonly acceptedTokens: ReadonlySet<string>;
}

/**
 * Build a real JSON Response, the shape the native transport clones and reads.
 * @param status - HTTP status.
 * @param bodyText - Serialized body.
 * @returns Response carrying a JSON content-type.
 */
function buildResponse(status: number, bodyText: string): Response {
  const headers = new Headers({ 'content-type': 'application/json' });
  return new Response(bodyText, { status, headers });
}

/**
 * Wrap a JSON object as a 200 Response.
 * @param payload - JSON-serializable payload.
 * @returns 200 Response.
 */
function jsonOk(payload: JsonObject): Response {
  const bodyText = JSON.stringify(payload);
  return buildResponse(200, bodyText);
}

/**
 * Synthetic UserDataV2 response.
 * @returns Customer + accounts envelope.
 */
function userDataV2Response(): JsonObject {
  return {
    data: {
      userDataV2: {
        getUserDataV2: {
          customerAndAccounts: [
            {
              customerId: SYN_CUSTOMER_ID,
              accounts: [{ accountId: SYN_ACCOUNT_ID, accountNumber: SYN_ACCOUNT_NUMBER }],
            },
          ],
        },
      },
    },
  };
}

/**
 * Synthetic balance response.
 * @returns Balance envelope carrying currentBalance.
 */
function balanceResponse(): JsonObject {
  return { data: { accounts: { balance: { currentBalance: SYN_BALANCE } } } };
}

/**
 * Synthetic transactions response (single page).
 * @returns Transactions envelope with 1 posted + 1 pending row.
 */
function transactionsResponse(): JsonObject {
  return {
    data: {
      accounts: {
        oshTransactionsNew: {
          totalCount: 2,
          transactions: [
            {
              transactionId: 'txn-1',
              transactionAmount: -12.5,
              bookingDate: '2026-03-10T00:00:00Z',
              effectiveDate: '2026-03-10T00:00:00Z',
              currency: 'ILS',
              description: 'Synthetic coffee',
            },
          ],
          pendingTransactions: [
            {
              transactionId: 'txn-2',
              transactionAmount: -5,
              bookingDate: '2026-03-15T00:00:00Z',
              effectiveDate: '2026-03-15T00:00:00Z',
              currency: 'ILS',
              description: 'Synthetic pending',
              liquidityStatus: 'pending',
            },
          ],
        },
      },
    },
  };
}

/**
 * Map a GraphQL queryname to the synthetic response.
 * @param queryname - queryname header value.
 * @returns JSON envelope for that operation.
 */
function graphqlByName(queryname: string): JsonObject {
  if (queryname === 'UserDataV2') return userDataV2Response();
  if (queryname === 'fetchAccountBalance') return balanceResponse();
  return transactionsResponse();
}

/**
 * Read the request headers the transport passed as a plain record.
 * @param init - Request init (may be absent).
 * @returns Header record (empty when missing).
 */
function headersOf(init?: RequestInit): Readonly<Record<string, string>> {
  const raw = init?.headers as Record<string, string> | undefined;
  return raw ?? {};
}

/**
 * Pick the queryname header from a RequestInit.
 * @param init - Request init (may be absent).
 * @returns queryname string ('' when missing).
 */
function pickQueryname(init?: RequestInit): string {
  const headers = headersOf(init);
  return headerOf(headers, 'queryname');
}

/** Args bundle for dispatch (respects the 3-param ceiling). */
interface IDispatchArgs {
  readonly url: string;
  readonly init?: RequestInit;
  readonly mock: IMockState;
}

/**
 * Serve an auth route through the synthetic Transmit server.
 * @param args - URL + init + mock state bundle.
 * @returns Response.
 */
function dispatchAuth(args: IDispatchArgs): Response {
  args.mock.tally.identity += 1;
  const headers = headersOf(args.init);
  const bodyText = typeof args.init?.body === 'string' ? args.init.body : '';
  const reply = handleAuthRequest(args.mock.server, { url: args.url, headers, bodyText });
  const replyText = JSON.stringify(reply.payload);
  return buildResponse(reply.status, replyText);
}

/**
 * Serve a GraphQL operation, refusing any bearer the mock never accepted.
 * @param args - URL + init + mock state bundle.
 * @returns Response.
 */
function dispatchGraphql(args: IDispatchArgs): Response {
  args.mock.tally.graphql += 1;
  const headers = headersOf(args.init);
  const bearer = headerOf(headers, 'authorization');
  const isAccepted = args.mock.acceptedTokens.has(bearer);
  if (!isAccepted) args.mock.tally.graphqlRejected += 1;
  if (!isAccepted) return buildResponse(401, '{"message":"Unauthorized"}');
  const qn = pickQueryname(args.init);
  const envelope = graphqlByName(qn);
  return jsonOk(envelope);
}

/**
 * Dispatch a URL + RequestInit to a synthetic response.
 * @param args - URL + init + mock state bundle.
 * @returns Response.
 */
function dispatch(args: IDispatchArgs): Response {
  if (args.url.includes('/auth/')) return dispatchAuth(args);
  if (args.url.includes('/graphql')) return dispatchGraphql(args);
  const notFoundText = JSON.stringify({ message: `unmocked: ${args.url}` });
  return buildResponse(404, notFoundText);
}

/**
 * Resolve a fetch input to its URL string form.
 * @param input - URL, Request, or string from fetch().
 * @returns URL string.
 */
function resolveUrl(input: RequestInfo | URL): string {
  if (input instanceof URL) return input.href;
  if (typeof input === 'string') return input;
  return input.url;
}

/**
 * Flatten a Headers object into the plain record the dispatchers read.
 * @param headers - Headers carried by a Request.
 * @returns Header record.
 */
function headersToRecord(headers: Headers): Record<string, string> {
  const entries = Array.from(headers);
  return Object.fromEntries(entries);
}

/**
 * Carry a Request input's method, headers and body into the init the dispatchers read.
 * An explicitly supplied init overrides the Request's own values.
 * @param input - URL, Request, or string from fetch().
 * @param init - Explicit request init (may be absent).
 * @returns Init holding everything the call sent.
 */
async function normalizeInit(input: RequestInfo | URL, init?: RequestInit): Promise<RequestInit> {
  if (typeof input === 'string' || input instanceof URL) return init ?? {};
  const body = await input.clone().text();
  const headers = headersToRecord(input.headers);
  return { method: input.method, headers, body, ...init };
}

/**
 * Build the mock fetch closure.
 * @param mock - Mock state (tallies, auth server, accepted bearers).
 * @returns Fetch-like function.
 */
function makeMockFetch(mock: IMockState): typeof globalThis.fetch {
  /**
   * Mock fetch handler — normalizes a Request input, then dispatches synchronously.
   * @param input - URL or Request.
   * @param init - Request init.
   * @returns Response Promise.
   */
  async function mockFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = resolveUrl(input);
    const resolvedInit = await normalizeInit(input, init);
    return dispatch({ url, init: resolvedInit, mock });
  }
  return mockFetch;
}

/**
 * Build the mock state from the caller's options.
 * @param options - Optional server behaviour.
 * @returns Fresh mock state.
 */
function createMockState(options: IPepperMockOptions): IMockState {
  const issuedToken = options.issuedToken ?? SYN_JWT;
  const devices = options.devices ?? [];
  const server = createPepperAuthServer({
    issuedToken,
    password: PEPPER_MOCK_CREDS.password,
    devices,
  });
  const acceptedTokens = new Set([issuedToken, ...(options.acceptedTokens ?? [])]);
  const tally: ICallTally = { identity: 0, graphql: 0, graphqlRejected: 0 };
  return { tally, server, acceptedTokens };
}

/**
 * Snapshot every tally of one mock instance.
 * @param mock - Mock state.
 * @returns Frozen per-route counts.
 */
function snapshotCounts(mock: IMockState): IMockCallCounts {
  const rejections = [...mock.server.rejections];
  return { ...mock.server.counts, ...mock.tally, rejections };
}

/**
 * Install the synthetic fetch mock.
 * @param options - Optional server behaviour (legacy defaults when omitted).
 * @returns Handle that restores original fetch + exposes call counts.
 */
export function installPepperFetchMock(options: IPepperMockOptions = {}): IMockHandle {
  const previousFetch = globalThis.fetch;
  const mock = createMockState(options);
  const mockFetch = makeMockFetch(mock);
  (globalThis as unknown as { fetch: typeof globalThis.fetch }).fetch = mockFetch;
  /**
   * Restore the original fetch.
   * @returns True once restored.
   */
  const dispose = (): boolean => {
    globalThis.fetch = previousFetch;
    return true;
  };
  /**
   * Snapshot the call counts.
   * @returns Frozen per-route tallies.
   */
  const callCounts = (): IMockCallCounts => snapshotCounts(mock);
  return { dispose, callCounts };
}
