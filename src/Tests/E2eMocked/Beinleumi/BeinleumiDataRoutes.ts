/**
 * Beinleumi mocked data routes — the portal BFF a logged-in shell reads: the
 * user's accounts, their type, the balance and the movements. Every call must
 * carry the authorization the SSO bought, the landing page as its sender, and
 * a fresh transaction id; every GET a fresh `uid`.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import { isDeepStrictEqual } from 'node:util';

import { bankMomentOfInstant } from '../../../Scrapers/Pipeline/Mediator/Scrape/BankCalendar.js';
import type { JsonUnknownRecord } from '../../../Scrapers/Pipeline/Types/JsonValue.js';
import type { IRecordedCall } from '../Helpers/FetchMockKit.js';
import { errorReply, parseBody } from '../Helpers/FetchMockKit.js';
import { json } from '../Helpers/MockReplies.js';
import { landingUrlOf } from './BeinleumiBrands.js';
import type { IBeinleumiMockState, Route } from './BeinleumiFaults.js';
import { checkWire, headerChecks, hit } from './BeinleumiFaults.js';
import {
  BEINLEUMI_MOCK_START_DATE,
  BN_ACCOUNT,
  BN_ACCOUNT_TYPE,
  BN_AUTHORIZATION,
  BN_BALANCE,
  BN_BANK_NOTICE,
  BN_OTHER_ACCOUNT,
  BN_TXNS,
} from './BeinleumiMockData.js';
import { UUID } from './BeinleumiPortalRoutes.js';
import { WIRE_PATHS, WIRE_UA } from './BeinleumiWireSpec.js';

/** The headers every BFF call carries, besides where it is sent from. */
const DATA_HEADERS = {
  authorization: BN_AUTHORIZATION,
  accept: 'application/json',
  'user-agent': WIRE_UA,
};

const DAY = 'YYYY-MM-DD';
const DAY_TEXT = /^\d{4}-\d{2}-\d{2}$/;

/** The first day of the window, as the bank's calendar names it. */
const START_DAY = bankMomentOfInstant(BEINLEUMI_MOCK_START_DATE).format(DAY);

/** The movements request, less its end day. */
const LIST_REQUEST = {
  accountNumber: Number(BN_ACCOUNT.account),
  accountType: BN_ACCOUNT_TYPE,
  branch: BN_ACCOUNT.branch,
  startDate: START_DAY,
  order: 0,
  language: 'HEB',
};

/** The movements request a list call sends. */
interface IListBody {
  readonly initialRequest?: { readonly endDate?: string };
}

/**
 * The checks every BFF call must pass: the logged-in shell's headers, sent
 * from the landing page, and a fresh transaction id.
 * @param state - Run state.
 * @param call - The call checked.
 * @returns The checks.
 */
function dataChecks(state: IBeinleumiMockState, call: IRecordedCall): Record<string, boolean> {
  const sender = { origin: state.brand.origin, referer: landingUrlOf(state.brand) };
  const headers = headerChecks(call, { ...DATA_HEADERS, ...sender });
  const txnId = call.headers.get('x-fibi-transaction-id') ?? '';
  return { ...headers, 'transaction id': UUID.test(txnId) };
}

/**
 * A BFF read: checked, then answered with its record.
 * @param name - The route name.
 * @param record - What the read answers.
 * @returns The route.
 */
function read(name: string, record: JsonUnknownRecord): Route {
  return (call, state): Response => {
    hit(state, name);
    const { searchParams } = new URL(call.url);
    const isUid = [...searchParams.keys()].length === 1 && UUID.test(searchParams.get('uid') ?? '');
    if (!checkWire(state, call, { ...dataChecks(state, call), uid: isUid })) return errorReply(400);
    return json(record);
  };
}

/**
 * The movements inside a window.
 * @param endDay - The window's last day.
 * @returns The rows registered from the start day through it.
 */
function rowsUpTo(endDay: string): readonly JsonUnknownRecord[] {
  return BN_TXNS.filter(row => {
    const day = String(row.dateOfRegistration).slice(0, DAY.length);
    return day >= START_DAY && day <= endDay;
  });
}

/**
 * The movements of the account, over the window the request names.
 * @param call - The request.
 * @param state - Run state.
 * @returns The rows, or a 400 when the request is off spec.
 */
function list(call: IRecordedCall, state: IBeinleumiMockState): Response {
  hit(state, 'list');
  const body = parseBody(call.body) as IListBody;
  const endDay = String(body.initialRequest?.endDate);
  const isEnd = DAY_TEXT.test(endDay) && endDay >= START_DAY;
  const isRequest = isDeepStrictEqual(body, {
    initialRequest: { ...LIST_REQUEST, endDate: endDay },
  });
  if (!checkWire(state, call, { ...dataChecks(state, call), end: isEnd, request: isRequest })) {
    return errorReply(400);
  }
  return json({ transactions: rowsUpTo(endDay) });
}

const ACCOUNTS = { accounts: [BN_ACCOUNT, BN_OTHER_ACCOUNT] };

const ACCOUNT_TYPE = read('accountType', { accountType: [{ accountType: BN_ACCOUNT_TYPE }] });

/**
 * The account-type lookup, which its fault fails with the bank's own text.
 * @param call - The request.
 * @param state - Run state.
 * @returns The account type, or a 500 quoting the bank.
 */
function accountType(call: IRecordedCall, state: IBeinleumiMockState): Response {
  if (state.fault !== 'accountType500') return ACCOUNT_TYPE(call, state);
  hit(state, 'accountType');
  return new Response(BN_BANK_NOTICE, { status: 500 });
}

const DATA_ROUTES: Readonly<Record<string, Route>> = {
  [`GET ${WIRE_PATHS.userData}`]: read('userData', ACCOUNTS),
  [`GET ${WIRE_PATHS.bff}/accountType`]: accountType,
  [`GET ${WIRE_PATHS.bff}/balances/${String(BN_ACCOUNT_TYPE)}`]: read('balance', {
    currentBalance: BN_BALANCE,
  }),
  [`POST ${WIRE_PATHS.bff}/list`]: list,
};

export default DATA_ROUTES;
