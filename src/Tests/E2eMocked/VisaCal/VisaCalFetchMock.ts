/**
 * Visa Cal synthetic fetch mock — stands in for CAL's two API gateways so the
 * browserless login and scrape run with no network.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 *
 * Login gateway (`api-cc` host), counted as `identity`:
 *   POST .../login/regularLogin  {username, password, uuid, newPassword}
 *   POST .../login/bioLogin      {hash}
 * Data gateway (`api` host), counted as `graphql` (the shared handle contract):
 *   POST .../account/init                  → two cards
 *   POST .../getCardTransactionsDetails    → rows for the card's debit month
 *   POST .../GetTotalFrameStatus           → the card's next debit
 *
 * The mock enforces what the real gateways enforce, so a broken request
 * fails here too: bioLogin accepts only a hash CAL issued and answers
 * statusCode 2 for any other; every accepted hash rotates; data calls need
 * the bioLogin token, CAL's web site id and a JSON content-type.
 */

import moment from 'moment';

import { CAL_WEB_SITE_ID } from '../../../Scrapers/Pipeline/Banks/VisaCal/scrape/VisaCalShapeHelpers.js';
import type { JsonUnknownRecord } from '../../../Scrapers/Pipeline/Types/JsonValue.js';

/** Tally values returned alongside dispose for wiring assertions. */
export interface IMockCallCounts {
  readonly identity: number;
  readonly graphql: number;
}

/** One request the pipeline sent, as the gateway saw it. */
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

/** A fault the regularLogin route can answer with instead of logging in. */
export type LoginFault = 'none' | 'http500' | 'reject' | 'nonJson' | 'timeout';

/** Synthetic credentials for mock-mode runs — safe for public fixtures. */
export const VISACAL_MOCK_CREDS = Object.freeze({
  username: 'synthetic-cal-user',
  password: 'synthetic-cal-pass',
});

/** A long-term hash CAL issued on an earlier run — the warm-start seed. */
export const SYN_STORED_HASH = 'syn-cal-stored-hash-5e1d';

/** The hash a password login issues. */
export const SYN_LOGIN_HASH = 'syn-cal-login-hash-9b3c';

/** Login session token; bioLogin's token is the one data calls must carry. */
const SYN_LOGIN_TOKEN = 'syn-cal-login-token-2f6a';
const SYN_BIO_TOKEN = 'syn-cal-bio-token-4a7f';

/** Authorization value every data call must carry. */
export const VISACAL_DATA_AUTH = `CALAuthScheme ${SYN_BIO_TOKEN}`;

/** Hashes bioLogin accepts — anything else is stale. */
const ISSUED_HASHES: ReadonlySet<string> = new Set([SYN_STORED_HASH, SYN_LOGIN_HASH]);

/**
 * The hash bioLogin hands back for a presented hash.
 * @param hash - Hash the run presented.
 * @returns Its rotated successor.
 */
export function rotatedHash(hash: string): string {
  return `${hash}.r1`;
}

/** One synthetic card with the next debit its frame reports. */
interface ISynCard {
  readonly cardUniqueId: string;
  readonly last4Digits: string;
  readonly nextTotalDebit: number;
}

/** Two cards, so per-card balance attribution is observable. */
export const VISACAL_MOCK_CARDS: readonly ISynCard[] = [
  { cardUniqueId: 'syn-card-uid-1', last4Digits: '4321', nextTotalDebit: 1520.4 },
  { cardUniqueId: 'syn-card-uid-2', last4Digits: '8765', nextTotalDebit: 310 },
];

/** Opens the scrape window two months back, before every synthetic row. */
export const VISACAL_MOCK_START_DATE = moment().subtract(2, 'months').startOf('month').toDate();

/** Purchases sit two days back so they are always inside the window. */
const PURCHASE_DAY = moment().subtract(2, 'days');

/** CAL indexes a billing month by its debit date — the month after purchase. */
const DEBIT_DAY = PURCHASE_DAY.clone().add(1, 'month').date(2);

/** The debit month as CAL's transactions body names it (1-based strings). */
const DEBIT_MONTH = String(DEBIT_DAY.month() + 1);
const DEBIT_YEAR_NUMBER = DEBIT_DAY.year();
const DEBIT_YEAR = String(DEBIT_YEAR_NUMBER);

/** Amounts of the rows each card reports. */
const VISACAL_ROW_AMOUNTS: readonly number[] = [51, 129.9];

/** Fields every synthetic row shares; ids and amounts vary per row. */
const BASE_ROW = Object.freeze({
  trnPurchaseDate: PURCHASE_DAY.format('YYYY-MM-DD[T]12:00:00'),
  debCrdDate: DEBIT_DAY.format('YYYY-MM-DD[T]00:00:00'),
  trnCurrencySymbol: '₪',
  debCrdCurrencySymbol: '₪',
  trnTypeCode: '5',
  numOfPayments: 0,
  curPaymentNum: 0,
  refundInd: false,
});

/**
 * One synthetic transaction row for a card.
 * @param card - Card the row belongs to.
 * @param amount - Charge amount.
 * @param index - Row position, used in the row's id.
 * @returns A CAL-shaped transaction row.
 */
function makeRow(card: ISynCard, amount: number, index: number): JsonUnknownRecord {
  const ordinal = String(index + 1);
  const trnIntId = `${card.cardUniqueId}-txn-${ordinal}`;
  const merchantName = `SYNTHETIC Merchant ${ordinal}`;
  return { ...BASE_ROW, trnIntId, merchantName, trnAmt: amount, amtBeforeConvAndIndex: amount };
}

/**
 * A JSON 200 response.
 * @param payload - Body to serialise.
 * @returns A real Response carrying the JSON.
 */
function jsonReply(payload: JsonUnknownRecord): Response {
  const bodyText = JSON.stringify(payload);
  return new Response(bodyText, { status: 200, headers: { 'content-type': 'application/json' } });
}

/**
 * A non-2xx response with a plain-text body.
 * @param status - HTTP status.
 * @returns A real Response with that status.
 */
function errorReply(status: number): Response {
  return new Response(`synthetic ${String(status)}`, { status });
}

/**
 * A successful login answer.
 * @param token - Session token to issue.
 * @param hash - Long-term hash to issue.
 * @returns statusCode 1 with the token and hash.
 */
function loginOk(token: string, hash: string): Response {
  return jsonReply({ statusCode: 1, result: { calConnectToken: token, hash } });
}

/**
 * The answer CAL gives a login it refuses.
 * @param statusCode - CAL's refusal code.
 * @returns The refusal, with no result.
 */
function loginRefused(statusCode: number): Response {
  return jsonReply({ statusCode, result: null });
}

/**
 * Parse a JSON request body.
 * @param body - Raw request body.
 * @returns The parsed object, or an empty one when the body is not JSON.
 */
function parseBody(body: string): JsonUnknownRecord {
  try {
    return JSON.parse(body) as JsonUnknownRecord;
  } catch {
    return {};
  }
}

/**
 * regularLogin — accepts only the synthetic credentials plus a device id.
 * @param body - Parsed request body.
 * @returns The login answer; statusCode 4 for anything else.
 */
function routeRegularLogin(body: JsonUnknownRecord): Response {
  const isKnownUser = body.username === VISACAL_MOCK_CREDS.username;
  const isRightPassword = body.password === VISACAL_MOCK_CREDS.password;
  const hasDeviceId = typeof body.uuid === 'string' && body.uuid.length > 0;
  if (!isKnownUser || !isRightPassword || !hasDeviceId) return loginRefused(4);
  return loginOk(SYN_LOGIN_TOKEN, SYN_LOGIN_HASH);
}

/**
 * bioLogin — trades an issued hash for a fresh token and a rotated hash.
 * @param body - Parsed request body.
 * @returns The login answer; statusCode 2 for a stale hash.
 */
function routeBioLogin(body: JsonUnknownRecord): Response {
  const hash = typeof body.hash === 'string' ? body.hash : '';
  if (!ISSUED_HASHES.has(hash)) return loginRefused(2);
  const nextHash = rotatedHash(hash);
  return loginOk(SYN_BIO_TOKEN, nextHash);
}

/** How regularLogin misbehaves under each injected fault. */
const LOGIN_FAULTS: Readonly<Record<Exclude<LoginFault, 'none'>, () => Promise<Response>>> = {
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

/**
 * The synthetic cards a request names.
 * @param cardUniqueId - Id the request named.
 * @returns The matching card, or none for an unknown id.
 */
function cardsWithId(cardUniqueId: unknown): readonly ISynCard[] {
  return VISACAL_MOCK_CARDS.filter(card => card.cardUniqueId === cardUniqueId);
}

/**
 * A card's synthetic rows.
 * @param card - Card the rows belong to.
 * @returns One row per synthetic amount.
 */
function rowsOf(card: ISynCard): readonly JsonUnknownRecord[] {
  return VISACAL_ROW_AMOUNTS.map((amount, index) => makeRow(card, amount, index));
}

/**
 * account/init — the card list.
 * @returns Both cards.
 */
function routeAccountInit(): Response {
  const cards = VISACAL_MOCK_CARDS.map(card => ({
    cardUniqueId: card.cardUniqueId,
    last4Digits: card.last4Digits,
  }));
  return jsonReply({ statusCode: 1, result: { cards } });
}

/**
 * Whether a transactions request names the synthetic rows' debit month.
 * @param body - Parsed request body {month, year}.
 * @returns True for the debit month.
 */
function isDebitMonth(body: JsonUnknownRecord): boolean {
  return body.month === DEBIT_MONTH && body.year === DEBIT_YEAR;
}

/**
 * getCardTransactionsDetails — a card's rows, served for their debit month.
 * @param body - Parsed request body {cardUniqueId, month, year}.
 * @returns The rows when the month is the debit month, else none.
 */
function routeTransactions(body: JsonUnknownRecord): Response {
  const cards = isDebitMonth(body) ? cardsWithId(body.cardUniqueId) : [];
  const rows = cards.flatMap(rowsOf);
  const bankAccounts = [
    { debitDates: [{ transactions: rows }], immidiateDebits: { debitDays: [] } },
  ];
  return jsonReply({ statusCode: 1, result: { bankAccounts } });
}

/** One card entry of a frames request. */
interface IFrameRequest {
  readonly cardUniqueId?: unknown;
}

/**
 * GetTotalFrameStatus — the next debit of each requested card.
 * @param body - Parsed request body {cardsForFrameData: [{cardUniqueId}]}.
 * @returns One frame per known requested card.
 */
function routeFrames(body: JsonUnknownRecord): Response {
  const requested = (body.cardsForFrameData ?? []) as readonly IFrameRequest[];
  const known = requested.flatMap(entry => cardsWithId(entry.cardUniqueId));
  const accountLevelFrames = known.map(card => ({
    cardUniqueId: card.cardUniqueId,
    nextTotalDebit: card.nextTotalDebit,
  }));
  return jsonReply({ statusCode: 1, result: { calIssuedCards: { accountLevelFrames } } });
}

/** Data routes keyed by the path suffix that names them. */
const DATA_ROUTES: readonly (readonly [string, (body: JsonUnknownRecord) => Response])[] = [
  ['/Authentication/api/account/init', routeAccountInit],
  ['/getCardTransactionsDetails', routeTransactions],
  ['/GetTotalFrameStatus', routeFrames],
];

/**
 * Whether a data call carries what the gateway demands.
 * @param headers - Request headers.
 * @returns True for the bioLogin token, CAL's site id and a JSON body type.
 */
function isAuthorised(headers: Headers): boolean {
  const hasToken = headers.get('authorization') === VISACAL_DATA_AUTH;
  const hasSiteId = headers.get('x-site-id') === CAL_WEB_SITE_ID;
  const contentType = headers.get('content-type') ?? '';
  return hasToken && hasSiteId && contentType.startsWith('application/json');
}

/**
 * Route a data-gateway call.
 * @param call - The recorded request.
 * @returns 401 when unauthorised, 404 for an unknown path, else the route.
 */
function routeData(call: IRecordedCall): Response {
  if (!isAuthorised(call.headers)) return errorReply(401);
  const route = DATA_ROUTES.find(([suffix]) => call.url.endsWith(suffix));
  if (!route) return errorReply(404);
  const body = parseBody(call.body);
  return route[1](body);
}

const LOGIN_HOST = 'https://api-cc.cal-online.co.il/';
const DATA_HOST = 'https://api.cal-online.co.il/';

/** Mutable state one installed mock keeps. */
interface IMockState {
  readonly fault: LoginFault;
  readonly log: IRecordedCall[];
  identity: number;
  graphql: number;
}

/**
 * Route a login-gateway call.
 * @param call - The recorded request.
 * @returns The login answer; 404 for an unknown path.
 */
function routeLogin(call: IRecordedCall): Response {
  const body = parseBody(call.body);
  if (call.url.endsWith('/login/bioLogin')) return routeBioLogin(body);
  if (call.url.endsWith('/login/regularLogin')) return routeRegularLogin(body);
  return errorReply(404);
}

/**
 * Answer a login-gateway call, injecting the fault into regularLogin.
 * @param call - The recorded request.
 * @param fault - Fault regularLogin answers with.
 * @returns The login answer; rejects for a network-level fault.
 */
function answerLogin(call: IRecordedCall, fault: LoginFault): Promise<Response> {
  const isPasswordLogin = call.url.endsWith('/login/regularLogin');
  if (isPasswordLogin && fault !== 'none') return LOGIN_FAULTS[fault]();
  const reply = routeLogin(call);
  return Promise.resolve(reply);
}

/**
 * Tally and route a call to any host other than the login gateway.
 * @param call - The recorded request.
 * @param state - Mock state, tallied in place.
 * @returns The data gateway's answer; 404 for any other host.
 */
function answerData(call: IRecordedCall, state: IMockState): Response {
  if (!call.url.startsWith(DATA_HOST)) return errorReply(404);
  state.graphql += 1;
  return routeData(call);
}

/**
 * Tally and route one request by the gateway it targets.
 * @param call - The recorded request.
 * @param state - Mock state, tallied in place.
 * @returns The gateway's answer; 404 for any other host.
 */
function dispatch(call: IRecordedCall, state: IMockState): Promise<Response> {
  if (call.url.startsWith(LOGIN_HOST)) {
    state.identity += 1;
    return answerLogin(call, state.fault);
  }
  const reply = answerData(call, state);
  return Promise.resolve(reply);
}

/** First argument accepted by globalThis.fetch. */
type FetchInput = string | Request | URL;

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
 * Capture a request as the gateway sees it.
 * @param input - First argument passed to fetch().
 * @param init - Fetch init.
 * @returns The recorded call.
 */
function recordCall(input: FetchInput, init?: RequestInit): IRecordedCall {
  const url = toUrlString(input);
  const method = init?.method ?? 'GET';
  const headers = new Headers(init?.headers);
  const body = typeof init?.body === 'string' ? init.body : '';
  return { url, method, headers, body };
}

/**
 * Build the fetch replacement over one state.
 * @param state - Mock state the calls are logged and tallied in.
 * @returns A function with fetch's signature.
 */
function makeMockFetch(state: IMockState): typeof fetch {
  return (input: FetchInput, init?: RequestInit): Promise<Response> => {
    const call = recordCall(input, init);
    state.log.push(call);
    return dispatch(call, state);
  };
}

/**
 * Install the synthetic CAL gateways over globalThis.fetch.
 * @param fault - Fault regularLogin answers with; `'none'` logs in normally.
 * @returns Handle with dispose, call counts and the call log.
 */
export function installVisaCalFetchMock(fault: LoginFault = 'none'): IMockHandle {
  const previousFetch = globalThis.fetch;
  const state: IMockState = { fault, log: [], identity: 0, graphql: 0 };
  globalThis.fetch = makeMockFetch(state);
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
