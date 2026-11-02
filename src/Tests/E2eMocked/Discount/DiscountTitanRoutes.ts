/**
 * Discount Titan routes — the accounts, one account's balance and one
 * account's rows. Every read needs the session and the MI6 cookie; an
 * account read also needs `AccountNumber` to name the account in its path.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import type { IRecordedCall } from '../Helpers/FetchMockKit.js';
import { errorReply } from '../Helpers/FetchMockKit.js';
import { json } from '../Helpers/MockReplies.js';
import type { IDiscountMockRun, Route } from './DiscountFaults.js';
import { DC_BANK_NOTICE, guarded } from './DiscountFaults.js';
import type { ISynAccount } from './DiscountMockData.js';
import {
  DC_FROM_DATE,
  DC_MI6,
  DC_SESSION_COOKIE,
  DISCOUNT_MOCK_ACCOUNTS,
  rowsOf,
  userAccounts,
} from './DiscountMockData.js';

/** Every Titan path starts here. */
export const TITAN_PATH = '/Titan/gatewayAPI/';

const BALANCE_PATH = `${TITAN_PATH}accountDetails/infoAndBalance/`;
const TXNS_PATH = `${TITAN_PATH}lastTransactions/transactions/`;

/** One account read: answers for the account its path and header name. */
type AccountAnswer = (account: ISynAccount, call: IRecordedCall) => Response;

/** No account: what a read finds when its path and `AccountNumber` disagree or name none. */
const NO_ACCOUNT: ISynAccount = { id: '', display: '', balance: 0, amounts: [] };

/**
 * The accounts — or a bank error under `titanError`.
 * @param _call - The recorded request.
 * @param run - The run's state.
 * @returns The `UserAccountsData` answer.
 */
function routeAccounts(_call: IRecordedCall, run: IDiscountMockRun): Response {
  if (run.fault === 'titanError') return json({ Error: { MsgText: DC_BANK_NOTICE } });
  return json({ UserAccountsData: { UserAccounts: userAccounts() } });
}

/**
 * The account a path names after its prefix, when `AccountNumber` agrees.
 * @param call - The recorded request.
 * @param prefix - The path before the account id.
 * @returns The account; {@link NO_ACCOUNT} for an unknown or unnamed one.
 */
function namedAccountOf(call: IRecordedCall, prefix: string): ISynAccount {
  const [id] = new URL(call.url).pathname.slice(prefix.length).split('/');
  if (call.headers.get('accountnumber') !== id) return NO_ACCOUNT;
  return DISCOUNT_MOCK_ACCOUNTS.find(account => account.id === id) ?? NO_ACCOUNT;
}

/**
 * Route an account read.
 * @param prefix - The path before the account id.
 * @param answer - Answers for the named account.
 * @returns A route answering 400 for an unknown or unnamed account.
 */
function accountRoute(prefix: string, answer: AccountAnswer): Route {
  return (call: IRecordedCall): Response => {
    const account = namedAccountOf(call, prefix);
    return account === NO_ACCOUNT ? errorReply(400) : answer(account, call);
  };
}

/**
 * One account's balance.
 * @param account - The named account.
 * @returns The `AccountInfoAndBalance` answer.
 */
function balanceOf(account: ISynAccount): Response {
  return json({ AccountInfoAndBalance: { AccountBalance: account.balance } });
}

/**
 * One account's rows, from the window's start.
 * @param account - The named account.
 * @param call - The recorded request.
 * @returns The `CurrentAccountLastTransactions` answer; 400 for another start.
 */
function txnsOf(account: ISynAccount, call: IRecordedCall): Response {
  const fromDate = new URL(call.url).searchParams.get('FromDate');
  if (fromDate !== DC_FROM_DATE) return errorReply(400);
  return json({ CurrentAccountLastTransactions: { OperationEntry: rowsOf(account) } });
}

/** What every Titan read needs. */
const TITAN_COOKIES: readonly string[] = [DC_SESSION_COOKIE, `mi6=${DC_MI6}`];

const BALANCE_ROUTE = accountRoute(BALANCE_PATH, balanceOf);
const TXNS_ROUTE = accountRoute(TXNS_PATH, txnsOf);

/** Titan routes keyed by `GET <path prefix>`. */
export const DATA_ROUTES: Readonly<Partial<Record<string, Route>>> = {
  [`GET ${TITAN_PATH}userAccountsData`]: guarded(TITAN_COOKIES, routeAccounts),
  [`GET ${BALANCE_PATH}`]: guarded(TITAN_COOKIES, BALANCE_ROUTE),
  [`GET ${TXNS_PATH}`]: guarded(TITAN_COOKIES, TXNS_ROUTE),
};
