/**
 * Hapoalim mock data routes — accounts, balance and movements, counted as
 * `graphql`. Each needs the session cookie the login earned.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 *
 *   GET  /ServerServices/general/accounts                          → account array
 *   GET  /ServerServices/current-account/composite/balanceAndCreditLimit
 *        ?partyCurrentAccount=<id>                                 → `currentBalance`
 *   POST /ServerServices/current-account/transactions?accountId=<id>
 *        body exactly `[]`, JSON content type, XSRF echo           → `transactions`
 */

import type { IRecordedCall } from '../Helpers/FetchMockKit.js';
import { errorReply } from '../Helpers/FetchMockKit.js';
import { bodiless, hasCookies, json, reply } from '../Helpers/MockReplies.js';
import type { HapoalimFault, IMockRun, Route } from './HapoalimFaults.js';
import { authCookieOf } from './HapoalimFaults.js';
import { accountOf, accountsBody, HP_XSRF_DECODED, rowsOf } from './HapoalimMockData.js';

const API = '/ServerServices';
const TXNS_TYPE = 'application/json;charset=UTF-8';

/** Data endpoints, counted apart from the login calls. */
export const HP_DATA_PATHS = {
  accounts: `${API}/general/accounts`,
  balance: `${API}/current-account/composite/balanceAndCreditLimit`,
  txns: `${API}/current-account/transactions`,
} as const;

/** A data fault's status, and its body (empty: none). */
type FaultReply = readonly [number, string];

/** What the movements call answers under each data fault. */
const TXNS_FAULT_REPLY: Readonly<Partial<Record<HapoalimFault, FaultReply>>> = {
  txns204: [204, ''],
  txns207: [207, '{"transactions":[]}'],
  expire401: [401, ''],
};

/**
 * The reply a data fault answers with.
 * @param fault - The fault's status and body.
 * @returns A bodiless reply when the body is empty, else the body.
 */
function faultReplyOf(fault: FaultReply): Response {
  const [status, body] = fault;
  return body === '' ? bodiless(status) : reply(status, body);
}

/**
 * One query parameter of a call.
 * @param call - The recorded request.
 * @param name - Parameter name.
 * @returns Its value, or empty when absent.
 */
function queryOf(call: IRecordedCall, name: string): string {
  const { searchParams } = new URL(call.url);
  return searchParams.get(name) ?? '';
}

/**
 * accounts — every account, closed ones included.
 * @returns The account array.
 */
function routeAccounts(): Response {
  const accounts = accountsBody();
  return json(accounts);
}

/**
 * balance — one account's current balance.
 * @param call - The recorded request.
 * @returns The balance, or 400 for an unknown account.
 */
function routeBalance(call: IRecordedCall): Response {
  const composite = queryOf(call, 'partyCurrentAccount');
  const acct = accountOf(composite);
  if (acct === false) return errorReply(400);
  return json({ currentBalance: acct.balance, withdrawalBalance: 999 });
}

/**
 * Whether a movements call carries what the bank requires.
 * @param call - The recorded request.
 * @returns True for an empty JSON array body with the JSON type and XSRF echo.
 */
function isTxnsRequest(call: IRecordedCall): boolean {
  const isJson = call.headers.get('content-type') === TXNS_TYPE;
  const isEcho = call.headers.get('x-xsrf-token') === HP_XSRF_DECODED;
  return call.body === '[]' && isJson && isEcho;
}

/**
 * movements — one account's rows, in one page.
 * @param call - The recorded request.
 * @param run - The run's fault.
 * @returns The rows, or the fault's answer.
 */
function routeTxns(call: IRecordedCall, run: IMockRun): Response {
  const faulted = TXNS_FAULT_REPLY[run.fault];
  if (faulted !== undefined) return faultReplyOf(faulted);
  const composite = queryOf(call, 'accountId');
  const acct = accountOf(composite);
  if (acct === false || !isTxnsRequest(call)) return errorReply(400);
  return json({ transactions: rowsOf(acct) });
}

/**
 * Guard a data route behind the run's session cookie.
 * @param route - The data route.
 * @returns The route, answering 401 without the cookie.
 */
function withSession(route: Route): Route {
  return (call: IRecordedCall, run: IMockRun): Response =>
    hasCookies(call, [authCookieOf(run)]) ? route(call, run) : errorReply(401);
}

/** Data routes keyed `<METHOD> <path>`. */
export const DATA_ROUTES: Readonly<Record<string, Route>> = {
  [`GET ${HP_DATA_PATHS.accounts}`]: withSession(routeAccounts),
  [`GET ${HP_DATA_PATHS.balance}`]: withSession(routeBalance),
  [`POST ${HP_DATA_PATHS.txns}`]: withSession(routeTxns),
};
