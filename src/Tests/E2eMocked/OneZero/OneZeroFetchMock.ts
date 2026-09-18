/**
 * OneZero synthetic fetch mock — intercepts globalThis.fetch for the OneZero
 * identity + GraphQL API so the pipeline can be exercised without network.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 * Rule #17: mock suite parity — 8/8 target.
 *
 * The mock serves the whole identity chain, so a cold login and a warm login
 * are both reachable:
 *   - POST <identityBase>.../devices/token
 *   - POST <identityBase>.../otp/prepare
 *   - POST <identityBase>.../otp/verify
 *   - POST <identityBase>.../getIdToken
 *   - POST <identityBase>.../sessions/token
 *   - POST <graphqlUrl>  (operation-name dispatch)
 *
 * `sessions/token` validates the `idToken` it is handed rather than accepting
 * anything, so an expired or opaque artifact is rejected the way the real bank
 * rejects it. Without that, a warm start replaying a dead token looked healthy
 * here while failing in production — the blind spot behind issue #576.
 *
 * Since fix/onezero-camoufox-identity-tls, identity calls route through the
 * Camoufox-backed strategy. The CamoufoxJsMock fake-page-eval mode is toggled
 * on so page.evaluate(fn, args) runs fn(args) in Node against this file's
 * globalThis.fetch override.
 */

import { setMtlsFetchFallback } from '../../../Scrapers/Pipeline/Strategy/Fetch/Mtls/MtlsTransport.js';
import { invokeFetch } from '../../../Scrapers/Pipeline/Strategy/Fetch/NativeFetchStrategy.js';
import { makeJwtExpiringIn, makeJwtExpiringInWithClaims } from '../../Helpers/Jwt.js';
import { setFakePageEvalMode } from '../../Mocks/CamoufoxJsMock.js';

/** Tally values returned alongside dispose for wiring assertions. */
export interface IMockCallCounts {
  readonly identity: number;
  readonly graphql: number;
}

/**
 * Handle returned by the installer.
 * `dispose()` restores the original fetch and returns `true` for Result-pattern
 * compliance (no void returns per architecture rule).
 */
export interface IMockHandle {
  readonly dispose: () => boolean;
  readonly callCounts: () => IMockCallCounts;
}

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;
const ONE_HOUR_SECONDS = 60 * 60;

/**
 * Long-lived artifact minted by /getIdToken — the handle warm start keeps.
 * The distinguishing `sub` keeps a freshly minted token textually different
 * from the stored seed, so a test can tell a cold mint from a warm reuse.
 */
export const SYN_ID_TOKEN = makeJwtExpiringInWithClaims(ONE_YEAR_SECONDS, {
  sub: 'syn-minted-id-token',
});

/** Short-lived artifact minted by /otp/verify — deliberately NOT persisted. */
const SYN_OTP_TOKEN = makeJwtExpiringIn(ONE_HOUR_SECONDS);

const SYN_DEVICE_TOKEN = 'syn-device-a7f4b2c8';
const SYN_OTP_CONTEXT = 'syn-otp-ctx-a7f4b2c8';
const SYN_ACCESS_TOKEN = 'syn-access-d3e9';
/** Synthetic credentials for mock-mode runs — safe for public fixtures. */
export const ONEZERO_MOCK_CREDS = Object.freeze({
  email: 'synthetic-onezero@example.test',
  password: 'synthetic-pass',
  phoneNumber: '972000000000',
  otpLongTermToken: makeJwtExpiringInWithClaims(ONE_YEAR_SECONDS, {
    sub: 'syn-stored-id-token',
  }),
});

const SYN_PORTFOLIO_ID = 'portfolio-a7f4b2c8';
const SYN_PORTFOLIO_NUM = '40286139';
const SYN_ACCOUNT_ID = 'acct-b7c4';
const SYN_CURSOR_PAGE_TWO = 'next-page';
const SYN_CURSOR_NONE = '';
const SYN_BALANCE = 2850.6;
const JWT_SEGMENTS = 3;
const MIN_OK_STATUS = 200;
const MAX_OK_STATUS = 300;

type JsonObject = Record<string, unknown>;

/** Minimal shape of a Response that the fetch callers consume. */
interface IResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly text: () => Promise<string>;
  readonly headers: { readonly getSetCookie: () => readonly string[] };
}

/** Empty Set-Cookie list reused across all synthetic responses. */
const NO_SET_COOKIES: readonly string[] = Object.freeze([]);

/**
 * Build the synthetic Headers slice consumed by the in-page fetch wrapper.
 * Returns an empty Set-Cookie list — the OneZero mock flow does not exercise
 * cookie warming.
 * @returns {object} Headers stub with a getSetCookie method returning [].
 */
function emptyHeaders(): IResponseLike['headers'] {
  /**
   * Returns the empty Set-Cookie list captured in NO_SET_COOKIES.
   * @returns Frozen empty Set-Cookie array.
   */
  const getSetCookie = (): readonly string[] => NO_SET_COOKIES;
  return { getSetCookie };
}

/** Accumulates call counts so tests can assert wiring. */
interface ICallTally {
  identity: number;
  graphql: number;
}

/**
 * Build a Response-shaped object suitable for fetch callers in the project
 * (they read `.ok`, `.status`, and `.text()`).
 * @param status - HTTP status code.
 * @param bodyText - Raw body text returned by response.text().
 * @returns A minimal Response-like object.
 */
function buildResponse(status: number, bodyText: string): IResponseLike {
  const isOkStatus = status >= MIN_OK_STATUS && status < MAX_OK_STATUS;
  /**
   * Closure returning the captured body text.
   * @returns Promise of body text.
   */
  const textFn = (): Promise<string> => Promise.resolve(bodyText);
  return { ok: isOkStatus, status, text: textFn, headers: emptyHeaders() };
}

/**
 * Wrap a JSON object as an OK Response-like.
 * @param payload - JSON-serializable payload.
 * @returns A 200 Response-like carrying the JSON text.
 */
function jsonOk(payload: JsonObject): IResponseLike {
  const bodyText = JSON.stringify(payload);
  return buildResponse(200, bodyText);
}

/**
 * Build a 404 Response-like carrying a canned error message.
 * @param message - Human-readable reason.
 * @returns A 404 Response-like.
 */
function notFound(message: string): IResponseLike {
  const bodyText = JSON.stringify({ message });
  return buildResponse(404, bodyText);
}

/**
 * Build a 401 Response-like carrying a bank-style error code.
 * @param errorCode - Identity-server error code, e.g. ErrorInvalidToken.
 * @returns A 401 Response-like.
 */
function rejected(errorCode: string): IResponseLike {
  const bodyText = JSON.stringify({ errorCode });
  return buildResponse(401, bodyText);
}

/** A single synthetic movement row. */
interface ISyntheticMovement extends JsonObject {
  readonly accountId: string;
  readonly bankCurrencyAmount: string;
  readonly bookingDate: string;
  readonly conversionRate: string;
  readonly creditDebit: string;
  readonly description: string;
  readonly isReversed: boolean;
  readonly movementAmount: string;
  readonly movementCurrency: string;
  readonly movementId: string;
  readonly movementTimestamp: string;
  readonly movementType: string;
  readonly portfolioId: string;
  readonly runningBalance: string;
  readonly valueDate: string;
}

/**
 * Build one synthetic movement record with the shape the mapper expects.
 * @param overrides - Per-row fields that differ from the baseline.
 * @returns A complete synthetic movement.
 */
function makeMovement(overrides: Partial<ISyntheticMovement>): ISyntheticMovement {
  const baseline: ISyntheticMovement = {
    accountId: SYN_ACCOUNT_ID,
    bankCurrencyAmount: '0',
    bookingDate: '2026-03-15',
    conversionRate: '1',
    creditDebit: 'DEBIT',
    description: 'synthetic row',
    isReversed: false,
    movementAmount: '0',
    movementCurrency: 'ILS',
    movementId: 'mov-000',
    movementTimestamp: '2026-03-15T10:00:00.000Z',
    movementType: 'SYNTHETIC',
    portfolioId: SYN_PORTFOLIO_ID,
    runningBalance: '0',
    valueDate: '2026-03-15',
  };
  return { ...baseline, ...overrides };
}

/** First-page movement rows (2 items). */
const PAGE_ONE_MOVEMENTS: readonly ISyntheticMovement[] = [
  makeMovement({
    movementId: 'mov-001',
    movementAmount: '47.50',
    creditDebit: 'DEBIT',
    description: 'synthetic coffee',
    runningBalance: '1850.00',
    movementTimestamp: '2026-03-15T10:00:00.000Z',
    valueDate: '2026-03-15',
  }),
  makeMovement({
    movementId: 'mov-002',
    movementAmount: '1200.00',
    creditDebit: 'CREDIT',
    description: 'synthetic refund',
    runningBalance: '3050.00',
    movementTimestamp: '2026-03-14T08:30:00.000Z',
    valueDate: '2026-03-14',
  }),
];

/** Second-page movement rows (1 item). */
const PAGE_TWO_MOVEMENTS: readonly ISyntheticMovement[] = [
  makeMovement({
    movementId: 'mov-003',
    movementAmount: '299.90',
    creditDebit: 'DEBIT',
    description: 'synthetic subscription',
    runningBalance: '1550.10',
    movementTimestamp: '2026-03-10T12:45:00.000Z',
    valueDate: '2026-03-10',
  }),
];

/**
 * Build the synthetic GetCustomer response — one portfolio, one account.
 * @returns GraphQL envelope carrying a single customer record.
 */
function customerEnvelope(): JsonObject {
  return {
    data: {
      customer: [
        {
          __typename: 'Customer',
          customerId: 'cust-syn-001',
          portfolios: [
            {
              __typename: 'Portfolio',
              portfolioId: SYN_PORTFOLIO_ID,
              portfolioNum: SYN_PORTFOLIO_NUM,
              accounts: [
                {
                  __typename: 'Account',
                  accountId: SYN_ACCOUNT_ID,
                  accountType: 'CHECKING',
                  currency: 'ILS',
                  status: 'ACTIVE',
                  subType: 'MAIN',
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

/** Pagination payload for a movements envelope. */
interface IPagination {
  readonly cursor: string | null;
  readonly hasMore: boolean;
}

/**
 * Build a movements page envelope given the rows + pagination values.
 * @param movements - Rows to embed.
 * @param pagination - Cursor + hasMore state for the page.
 * @returns GraphQL envelope for the movements query.
 */
function movementsEnvelope(
  movements: readonly ISyntheticMovement[],
  pagination: IPagination,
): JsonObject {
  return {
    data: {
      movements: {
        __typename: 'Movements',
        isRunningBalanceInSync: true,
        movements,
        pagination: {
          __typename: 'Pagination',
          cursor: pagination.cursor,
          hasMore: pagination.hasMore,
        },
      },
    },
  };
}

/**
 * Build the synthetic GetAccountBalance response.
 * @returns GraphQL envelope with the synthetic balance figures.
 */
function balanceEnvelope(): JsonObject {
  return {
    data: {
      balance: {
        currentAccountBalance: SYN_BALANCE,
        currentAccountBalanceStr: '2850.60',
        blockedAmountStr: '0',
        limitAmountStr: '10000',
      },
    },
  };
}

/** Parsed GraphQL request body (just enough to route by operation). */
interface IGraphqlRequestBody {
  readonly query?: string;
  readonly variables?: { readonly pagination?: { readonly cursor?: string | null } };
}

/**
 * Parse a fetch request init body into a GraphQL-shaped request.
 * @param init - Fetch init as passed by the caller.
 * @returns Parsed body, or an empty object when parsing fails.
 */
function parseGraphqlBody(init?: RequestInit): IGraphqlRequestBody {
  const raw = init?.body;
  if (typeof raw !== 'string') return {};
  try {
    return JSON.parse(raw) as IGraphqlRequestBody;
  } catch {
    return {};
  }
}

/**
 * Determine which GraphQL operation is being requested.
 * @param query - The GraphQL query string.
 * @returns Operation tag: 'customer' | 'movements' | 'balance' | 'unknown'.
 */
function detectOperation(query: string): 'customer' | 'movements' | 'balance' | 'unknown' {
  if (query.includes('GetCustomer')) return 'customer';
  if (query.includes('GetMovements')) return 'movements';
  if (query.includes('GetAccountBalance')) return 'balance';
  return 'unknown';
}

/**
 * Route a GraphQL request to the matching synthetic envelope.
 * @param body - Parsed request body.
 * @returns Response-like envelope for the detected operation.
 */
function routeGraphql(body: IGraphqlRequestBody): IResponseLike {
  const query = body.query ?? '';
  const operation = detectOperation(query);
  if (operation === 'customer') {
    const payload = customerEnvelope();
    return jsonOk(payload);
  }
  if (operation === 'balance') {
    const payload = balanceEnvelope();
    return jsonOk(payload);
  }
  if (operation === 'movements') return routeMovements(body);
  return jsonOk({ errors: [{ message: 'unknown mock graphql operation' }] });
}

/**
 * Route a GetMovements request to page one or page two depending on cursor.
 * @param body - Parsed request body.
 * @returns Response-like envelope with the appropriate page.
 */
function routeMovements(body: IGraphqlRequestBody): IResponseLike {
  const cursor = body.variables?.pagination?.cursor ?? SYN_CURSOR_NONE;
  if (cursor === SYN_CURSOR_PAGE_TWO) {
    const pagination: IPagination = { cursor: null, hasMore: false };
    const payload = movementsEnvelope(PAGE_TWO_MOVEMENTS, pagination);
    return jsonOk(payload);
  }
  const pagination: IPagination = { cursor: SYN_CURSOR_PAGE_TWO, hasMore: true };
  const payload = movementsEnvelope(PAGE_ONE_MOVEMENTS, pagination);
  return jsonOk(payload);
}

/** Returned by readExpSeconds when a token carries no usable expiry. */
const NO_EXPIRY = 0;

/**
 * Decode the `exp` claim of a compact JWT.
 * @param token - Candidate token.
 * @returns Expiry in epoch seconds, or NO_EXPIRY when the token carries none.
 */
function readExpSeconds(token: string): number {
  const segments = token.split('.');
  if (segments.length !== JWT_SEGMENTS) return NO_EXPIRY;
  try {
    const json = Buffer.from(segments[1], 'base64url').toString('utf8');
    const decoded = JSON.parse(json) as { exp?: unknown };
    const exp = decoded.exp;
    return typeof exp === 'number' ? exp : NO_EXPIRY;
  } catch {
    return NO_EXPIRY;
  }
}

/**
 * Decide whether the bank would still honour a token.
 * Opaque and expired artifacts are both rejected, exactly as the real identity
 * server rejects them.
 *
 * Assumption on record: OneZero's artifacts are JWTs — the capture in issue
 * #576 decodes `iat`/`exp` on both. Identity servers may legitimately issue
 * opaque handles, so if OneZero ever switches, this fixture will start failing
 * runs that the real bank would accept. Read that as a fixture to update, not
 * as a product regression.
 * @param token - Token lifted from the request body.
 * @returns True when the token is a JWT that has not expired.
 */
function isAcceptedByBank(token: string): boolean {
  if (token === '') return false;
  const expSeconds = readExpSeconds(token);
  const nowSeconds = Math.floor(Date.now() / 1000);
  return expSeconds > nowSeconds;
}

/**
 * Read one string field out of a JSON request body.
 * @param field - Field name to lift.
 * @param init - Fetch init carrying the serialized body.
 * @returns The field value, or an empty string when absent or unparseable.
 */
function readBodyString(field: string, init?: RequestInit): string {
  const raw = init?.body;
  if (typeof raw !== 'string') return '';
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const value = parsed[field];
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

/**
 * Serve /getIdToken, which the bank gates on a live otpSmsToken.
 * @param init - Fetch init carrying the request body.
 * @returns Response-like envelope carrying the durable idToken.
 */
function routeGetIdToken(init?: RequestInit): IResponseLike {
  const otpSmsToken = readBodyString('otpSmsToken', init);
  const isLive = isAcceptedByBank(otpSmsToken);
  if (!isLive) return rejected('ErrorInvalidToken');
  return jsonOk({ resultData: { idToken: SYN_ID_TOKEN } });
}

/**
 * Serve /sessions/token, which mints a short-lived access token from an idToken.
 * @param init - Fetch init carrying the request body.
 * @returns Response-like envelope carrying the access token.
 */
function routeSessionToken(init?: RequestInit): IResponseLike {
  const idToken = readBodyString('idToken', init);
  const isLive = isAcceptedByBank(idToken);
  if (!isLive) return rejected('ErrorInvalidToken');
  return jsonOk({ resultData: { accessToken: SYN_ACCESS_TOKEN } });
}

/** Identity routes that need no request-body validation. */
const STATIC_IDENTITY_ROUTES: readonly (readonly [string, JsonObject])[] = [
  ['devices/token', { resultData: { deviceToken: SYN_DEVICE_TOKEN } }],
  ['otp/prepare', { resultData: { otpContext: SYN_OTP_CONTEXT } }],
  ['otp/verify', { resultData: { otpToken: SYN_OTP_TOKEN } }],
];

/**
 * Route an identity request across the full login chain.
 * @param url - Request URL (already classified as identity).
 * @param init - Fetch init carrying the request body.
 * @returns Response-like envelope for the detected path.
 */
function routeIdentity(url: string, init?: RequestInit): IResponseLike {
  const staticRoute = STATIC_IDENTITY_ROUTES.find(([path]) => url.includes(path));
  if (staticRoute) return jsonOk(staticRoute[1]);
  if (url.includes('getIdToken')) return routeGetIdToken(init);
  if (url.includes('sessions/token')) return routeSessionToken(init);
  return notFound('unknown mock identity route');
}

/** Request classification — used to route and to tally call counts. */
type RequestClass = 'identity' | 'graphql' | 'unknown';

/** Narrow type alias for the first argument accepted by globalThis.fetch. */
type FetchInput = string | Request | URL;

/** Arguments tuple accepted by the synthetic fetch mock. */
type FetchArgs = [FetchInput, RequestInit?];

/** The callable signature used for globalThis.fetch replacement. */
type MockFetch = (...args: FetchArgs) => Promise<Response>;

/**
 * Classify a request URL into identity / graphql / unknown.
 * @param url - Target URL of the fetch call.
 * @returns Classification tag.
 */
function classify(url: string): RequestClass {
  const isIdentity =
    url.includes('identity.') || url.includes('/getIdToken') || url.includes('/sessions/token');
  if (isIdentity) return 'identity';
  const isGraphql = url.includes('graphql') || url.includes('mobile-graph');
  if (isGraphql) return 'graphql';
  return 'unknown';
}

/**
 * Dispatch one fetch call to the matching synthetic responder and tally.
 * @param url - Target URL.
 * @param tally - Call counter mutated in place.
 * @param init - Fetch init (optional — only GraphQL needs body parsing).
 * @returns A Response-like the caller will read.
 */
function dispatch(url: string, tally: ICallTally, init?: RequestInit): IResponseLike {
  const kind = classify(url);
  if (kind === 'identity') {
    tally.identity += 1;
    return routeIdentity(url, init);
  }
  if (kind === 'graphql') {
    tally.graphql += 1;
    const body = parseGraphqlBody(init);
    return routeGraphql(body);
  }
  return notFound('unknown mock route');
}

/**
 * Normalize a fetch input (string | Request | URL) into a plain string URL.
 * @param input - The first argument passed to fetch().
 * @returns The URL as a string.
 */
function toUrlString(input: FetchInput): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/**
 * Fabricate the synthetic fetch implementation with a bound tally.
 * @param tally - Shared counter for identity/graphql calls.
 * @returns A plain function that mimics globalThis.fetch for the OneZero API.
 */
function makeMockFetch(tally: ICallTally): MockFetch {
  return (input: FetchInput, init?: RequestInit): Promise<Response> => {
    const urlString = toUrlString(input);
    const response = dispatch(urlString, tally, init);
    return Promise.resolve(response as unknown as Response);
  };
}

/**
 * Install the synthetic fetch override. Dispose restores the original.
 * @returns Handle with dispose + call-count inspector.
 */
export function installOneZeroFetchMock(): IMockHandle {
  const previousFetch = globalThis.fetch;
  const tally: ICallTally = { identity: 0, graphql: 0 };
  const mockFetch = makeMockFetch(tally);
  (globalThis as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;
  setFakePageEvalMode(true);
  setMtlsFetchFallback(invokeFetch);
  /**
   * Restore the original fetch implementation and reset the Camoufox mock.
   * @returns True once restoration completes.
   */
  const dispose = (): boolean => {
    globalThis.fetch = previousFetch;
    setFakePageEvalMode(false);
    setMtlsFetchFallback();
    return true;
  };
  /**
   * Snapshot the current identity/graphql tallies.
   * @returns Immutable snapshot of counts.
   */
  const callCounts = (): IMockCallCounts => ({
    identity: tally.identity,
    graphql: tally.graphql,
  });
  return { dispose, callCounts };
}
