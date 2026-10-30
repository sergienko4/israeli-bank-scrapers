/**
 * Max synthetic fetch mock — stands in for max.co.il so the browserless login
 * and scrape run with no network.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 *
 * Login, counted as `identity`:
 *   GET  /api/registered/clientcontext  → the pre-login cookie
 *   POST /api/login/login               {username, password, id: null} → the auth cookie
 * Data, counted as `graphql` (the shared handle contract):
 *   GET /api/registered/getHomePageData → two cards, each with its ILS cycle debit
 *   GET .../getTransactionsAndGraphs    → every card's rows for the filterData month,
 *                                         filtered per card by the shape
 *
 * The mock enforces what max.co.il enforces, so a broken request fails here
 * too: login needs the pre-login cookie and answers 500 unless `id` is null;
 * data calls need the auth cookie and answer an empty 403 without it.
 */

import moment from 'moment';

import { ILS_CURRENCY_CODE } from '../../../Scrapers/Pipeline/Registry/WK/BalanceResolveWK.js';
import type { JsonUnknownRecord } from '../../../Scrapers/Pipeline/Types/JsonValue.js';
import type {
  CallKind,
  IMockHandle,
  IRecordedCall,
  NetworkFault,
} from '../Helpers/FetchMockKit.js';
import {
  errorReply,
  installFetchMock,
  jsonReply,
  NETWORK_FAULTS,
  parseBody,
} from '../Helpers/FetchMockKit.js';

/** How the mock misbehaves: a step-0 fault, a login refusal or a lost session. */
export type MaxFault = 'none' | NetworkFault | 'changePassword' | 'unknownStatus' | 'expireSession';

/** Synthetic credentials for mock-mode runs — safe for public fixtures. */
export const MAX_MOCK_CREDS = Object.freeze({
  username: 'synthetic-max-user',
  password: 'synthetic-max-pass',
});

/** Cookie clientcontext sets and login demands. */
const PRE_COOKIE = 'NotAuthOnline40V3=syn-max-pre-7d2e';

/** Cookie a successful login sets and every data call demands. */
export const MAX_AUTH_COOKIE = '.AUTHONLINE40V3=syn-max-auth-3c9b';

const ORIGIN = 'https://www.max.co.il';
const PRIME_URL = `${ORIGIN}/api/registered/clientcontext`;
const LOGIN_URL = `${ORIGIN}/api/login/login`;
const DATA_PREFIX = `${ORIGIN}/api/registered/`;

/** One synthetic card with the cycle debit its summary reports. */
interface ISynCard {
  readonly last4: string;
  readonly cycleDebit: number;
}

/** Two cards, so per-card balance and row attribution are observable. */
export const MAX_MOCK_CARDS: readonly ISynCard[] = [
  { last4: '4321', cycleDebit: 1520.4 },
  { last4: '8765', cycleDebit: 310 },
];

/** Amounts of the rows each card reports. */
export const MAX_ROW_AMOUNTS: readonly number[] = [51, 129.9];

/** Purchases sit two days back so they are always inside the window. */
const PURCHASE_DAY = moment().subtract(2, 'days');

/** The month getTransactionsAndGraphs serves the rows on, as filterData names it. */
const ROWS_MONTH = PURCHASE_DAY.format('YYYY-M-01');

/** Fields every synthetic row shares; card, ids and amounts vary per row. */
const BASE_ROW = Object.freeze({
  purchaseDate: PURCHASE_DAY.format('YYYY-MM-DD[T]00:00:00'),
  originalCurrency: 'ILS',
});

/** The LoginStatus a fault forces, overriding the credential check. */
const FAULT_LOGIN_STATUS: Partial<Record<MaxFault, number>> = {
  changePassword: 1,
  unknownStatus: 2,
};

/**
 * Whether a call carries a cookie.
 * @param call - The recorded request.
 * @param cookie - `name=value` pair to look for.
 * @returns True when the Cookie header holds the pair.
 */
function hasCookie(call: IRecordedCall, cookie: string): boolean {
  const pairs = (call.headers.get('cookie') ?? '').split('; ');
  return pairs.includes(cookie);
}

/**
 * A Set-Cookie line for a pair.
 * @param cookie - `name=value` pair.
 * @returns The line, scoped to the whole site.
 */
function setCookieOf(cookie: string): string {
  return `${cookie}; Path=/; HttpOnly; Secure`;
}

/**
 * The LoginStatus a login body earns.
 * @param body - Parsed login body.
 * @param fault - Fault the mock answers with.
 * @returns 0 for the synthetic credentials, 4 for any other, or the fault's status.
 */
function loginStatusOf(body: JsonUnknownRecord, fault: MaxFault): number {
  const forced = FAULT_LOGIN_STATUS[fault];
  if (forced !== undefined) return forced;
  const isKnownUser = body.username === MAX_MOCK_CREDS.username;
  const isRightPassword = body.password === MAX_MOCK_CREDS.password;
  return isKnownUser && isRightPassword ? 0 : 4;
}

/**
 * login — needs the pre-login cookie and a null `id`.
 * @param call - The recorded request.
 * @param fault - Fault the mock answers with.
 * @returns The LoginStatus answer, with the auth cookie on success.
 */
function routeLogin(call: IRecordedCall, fault: MaxFault): Response {
  if (!hasCookie(call, PRE_COOKIE)) return new Response('', { status: 403 });
  const body = parseBody(call.body);
  if (body.id !== null) return errorReply(500);
  const status = loginStatusOf(body, fault);
  const setCookie = status === 0 ? setCookieOf(MAX_AUTH_COOKIE) : '';
  return jsonReply({ Result: { LoginStatus: status } }, setCookie);
}

/**
 * One synthetic transaction row for a card.
 * @param card - Card the row belongs to.
 * @param amount - Charge amount.
 * @param index - Row position, used in the row's id.
 * @returns A Max-shaped transaction row.
 */
function makeRow(card: ISynCard, amount: number, index: number): JsonUnknownRecord {
  const ordinal = String(index + 1);
  const arn = `syn-max-arn-${card.last4}-${ordinal}`;
  const merchantName = `SYNTHETIC Merchant ${ordinal}`;
  const amounts = { actualPaymentAmount: amount, originalAmount: amount };
  return { ...BASE_ROW, shortCardNumber: card.last4, arn, merchantName, ...amounts };
}

/**
 * A card's synthetic rows.
 * @param card - Card the rows belong to.
 * @returns One row per synthetic amount.
 */
function rowsOf(card: ISynCard): readonly JsonUnknownRecord[] {
  return MAX_ROW_AMOUNTS.map((amount, index) => makeRow(card, amount, index));
}

/**
 * getHomePageData — the card list, each card with its ILS cycle summary.
 * @returns Both cards.
 */
function routeHomePage(): Response {
  const cards = MAX_MOCK_CARDS.map(card => ({
    Last4Digits: card.last4,
    CycleSummary: [{ Currency: ILS_CURRENCY_CODE, TotalDebitSum: card.cycleDebit }],
  }));
  return jsonReply({ Result: { UserCards: { Cards: cards } } });
}

/**
 * The month a transactions call names.
 * @param url - Request URL carrying the filterData query.
 * @returns filterData's `date`, or empty when it names none.
 */
function monthOf(url: string): string {
  const filterData = new URL(url).searchParams.get('filterData') ?? '';
  const filter = parseBody(filterData);
  return typeof filter.date === 'string' ? filter.date : '';
}

/**
 * getTransactionsAndGraphs — every card's rows, served for their month.
 * @param call - The recorded request.
 * @returns The rows when the month is the rows' month, else none.
 */
function routeTransactions(call: IRecordedCall): Response {
  const isRowsMonth = monthOf(call.url) === ROWS_MONTH;
  const transactions = isRowsMonth ? MAX_MOCK_CARDS.flatMap(rowsOf) : [];
  return jsonReply({ result: { transactions } });
}

/** Data routes keyed by the path that names them. */
const DATA_ROUTES: Readonly<Partial<Record<string, (call: IRecordedCall) => Response>>> = {
  '/api/registered/getHomePageData': routeHomePage,
  '/api/registered/transactionDetails/getTransactionsAndGraphs': routeTransactions,
};

/**
 * Route a data call.
 * @param call - The recorded request.
 * @param isExpired - Whether the session is gone even with its cookie.
 * @returns An empty 403 without a live session, 404 for an unknown path, else the route.
 */
function routeData(call: IRecordedCall, isExpired: boolean): Response {
  if (isExpired || !hasCookie(call, MAX_AUTH_COOKIE)) return new Response('', { status: 403 });
  const { pathname } = new URL(call.url);
  const route = DATA_ROUTES[pathname];
  return route ? route(call) : errorReply(404);
}

/**
 * Whether a fault is a transport failure.
 * @param fault - Fault the mock answers with.
 * @returns True for the kit's network faults.
 */
function isNetworkFault(fault: MaxFault): fault is NetworkFault {
  return fault in NETWORK_FAULTS;
}

/**
 * clientcontext — step 0, where a transport fault lands.
 * @param fault - Fault the mock answers with.
 * @returns The client context with the pre-login cookie; rejects for a network fault.
 */
function answerPrime(fault: MaxFault): Promise<Response> {
  if (isNetworkFault(fault)) return NETWORK_FAULTS[fault]();
  const setCookie = setCookieOf(PRE_COOKIE);
  const reply = jsonReply({ Result: { IsAuthenticated: false } }, setCookie);
  return Promise.resolve(reply);
}

/**
 * The tally a call counts toward.
 * @param call - The recorded request.
 * @returns `identity` for a login call, `graphql` for a data call.
 */
export function classifyMax(call: IRecordedCall): CallKind {
  if (call.url === PRIME_URL || call.url === LOGIN_URL) return 'identity';
  return call.url.startsWith(DATA_PREFIX) ? 'graphql' : 'other';
}

/**
 * Route one request.
 * @param call - The recorded request.
 * @param fault - Fault the mock answers with.
 * @returns The site's answer; 404 for any other host.
 */
function answerMax(call: IRecordedCall, fault: MaxFault): Promise<Response> {
  if (call.url === PRIME_URL) return answerPrime(fault);
  const isLogin = call.url === LOGIN_URL;
  const reply = isLogin ? routeLogin(call, fault) : routeData(call, fault === 'expireSession');
  return Promise.resolve(reply);
}

/** Opens the scrape window two months back, before every synthetic row. */
export const MAX_MOCK_START_DATE = moment().subtract(2, 'months').startOf('month').toDate();

/**
 * Install the synthetic max.co.il over globalThis.fetch.
 * @param fault - Fault the mock answers with; `'none'` behaves normally.
 * @returns Handle with dispose, call counts and the call log.
 */
export function installMaxFetchMock(fault: MaxFault = 'none'): IMockHandle {
  return installFetchMock({
    classify: classifyMax,
    /**
     * Answer one call.
     * @param call - The recorded request.
     * @returns The site's answer.
     */
    answer: (call: IRecordedCall): Promise<Response> => answerMax(call, fault),
  });
}
