/**
 * Discount synthetic fetch mock — stands in for start.telebank.co.il so the
 * browserless login and Titan scrape run with no network.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 *
 * Login, counted as `identity`:
 *   GET  /login/<brand query>                   → the login page; XSRF-TOKEN + tuuid
 *   POST /Lobby/gatewayAPI/verification/getInfo → the RSA key; rotates XSRF-TOKEN
 *   POST /Lobby/gatewayAPI/login                → 302 to loginSuccessResponse + the session
 *   GET  /Lobby/gatewayAPI/loginSuccessResponse → `Login.Status` + `Login.MI6`
 *   GET  /apollo/retail3                        → 301 → /apollo/retail3/ → the retail page
 * Data, counted as `graphql`:
 *   GET  /Titan/gatewayAPI/userAccountsData                        → the accounts
 *   GET  /Titan/gatewayAPI/accountDetails/infoAndBalance/{id}      → one balance
 *   GET  /Titan/gatewayAPI/lastTransactions/transactions/{id}/Date → one account's rows
 *
 * The mock enforces what the bank enforces, so a broken request fails here
 * too: the login page needs the brand's query and its four client cookies,
 * getInfo and login name the brand's bank code; every later call needs
 * the latest XSRF-TOKEN, decoded; login needs both seals to open; everything
 * after login needs the session; the landing and Titan need the MI6 cookie;
 * an account read needs `AccountNumber` to name the account in its path.
 */

import type { CallKind, IMockHandle, IRecordedCall } from '../Helpers/FetchMockKit.js';
import { errorReply, installFetchMock } from '../Helpers/FetchMockKit.js';
import type { ITelebankMockBrand } from './DiscountBrands.js';
import { DISCOUNT_MOCK_BRAND } from './DiscountBrands.js';
import type { DiscountFault, IDiscountMockRun, Route } from './DiscountFaults.js';
import { LOGIN_ROUTES } from './DiscountLoginRoutes.js';
import { DC_ORIGIN } from './DiscountMockData.js';
import { DATA_ROUTES, TITAN_PATH } from './DiscountTitanRoutes.js';

/** The Titan route keys, matched as prefixes. */
const DATA_KEYS: readonly string[] = Object.keys(DATA_ROUTES);

/**
 * Answer a call nothing routes.
 * @returns A 404.
 */
function unrouted(): Response {
  return errorReply(404);
}

/**
 * The route a call belongs to.
 * @param call - The recorded request.
 * @returns The route; {@link unrouted} off the origin or for any other path.
 */
function routeOf(call: IRecordedCall): Route {
  const { origin, pathname } = new URL(call.url);
  if (origin !== DC_ORIGIN) return unrouted;
  const key = `${call.method} ${pathname}`;
  const dataKey = DATA_KEYS.find(known => key.startsWith(known)) ?? '';
  return LOGIN_ROUTES[key] ?? DATA_ROUTES[dataKey] ?? unrouted;
}

/**
 * The tally a call counts toward.
 * @param call - The recorded request.
 * @returns `graphql` for a Titan read, `identity` for any other bank call.
 */
export function classifyDiscount(call: IRecordedCall): CallKind {
  const { origin, pathname } = new URL(call.url);
  if (origin !== DC_ORIGIN) return 'other';
  return pathname.startsWith(TITAN_PATH) ? 'graphql' : 'identity';
}

/**
 * Answer one call.
 * @param run - The run's state.
 * @param call - The recorded request.
 * @returns The bank's answer.
 */
function answerDiscount(run: IDiscountMockRun, call: IRecordedCall): Promise<Response> {
  const route = routeOf(call);
  const response = route(call, run);
  return Promise.resolve(response);
}

/**
 * Install the synthetic Telebank bank over globalThis.fetch.
 * @param fault - Fault the mock answers with; `'none'` behaves normally.
 * @param brand - The bank the mock plays; Discount by default.
 * @returns Handle with dispose, call counts and the call log.
 */
export function installDiscountFetchMock(
  fault: DiscountFault = 'none',
  brand: ITelebankMockBrand = DISCOUNT_MOCK_BRAND,
): IMockHandle {
  const run: IDiscountMockRun = { fault, brand, xsrf: '', uid: '', isLoginOk: false };
  const answer = answerDiscount.bind(null, run);
  return installFetchMock({ classify: classifyDiscount, answer });
}
