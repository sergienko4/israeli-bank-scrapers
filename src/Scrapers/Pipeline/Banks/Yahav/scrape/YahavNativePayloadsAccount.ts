/**
 * Yahav native BaNCS inquiry payloads — the per-account reads:
 * the current-account balance and the transactions in a date window. Each
 * names the account by id and IOR id and its portfolio by IOR id.
 */

import type { VarsMap } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import {
  ILS_CURRENCY,
  type IYahavNativeRef,
  yahavArchetype,
  yahavInquiry,
  yahavPortfolioRefs,
} from './YahavNativePayloads.js';

/** A calendar day as BaNCS dates carry it. */
interface IYahavNativeDay {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** An account and the portfolio that holds it. */
interface IYahavAccountRefs {
  readonly portfolio: IYahavNativeRef;
  readonly account: IYahavNativeRef;
}

/** An account and an inclusive date window. */
interface IYahavTxnsArgs extends IYahavAccountRefs {
  readonly from: IYahavNativeDay;
  readonly to: IYahavNativeDay;
}

/** The current-account balance block asked for. */
const BALANCE_LIST = Object.freeze([
  {
    ...yahavArchetype('AccountBalance_1.0.0'),
    CurrAmt: { ...yahavArchetype('CurrencyAmount_1.0.0'), Amt: yahavArchetype('Amount_1.0.0') },
  },
]);

/**
 * The identifier block of an account.
 * @param account - The account.
 * @returns Account identifier.
 */
function accountId(account: IYahavNativeRef): VarsMap {
  const id = { Ver: 'Identifier_1.0.0', Id: account.id };
  const head = { Ver: 'AccountIdentifier_1.0.0', AcctIds: { BANKACCOUNTID: '' } };
  return { ...head, Id: id, iorId: account.iorId };
}

/**
 * One bound of the transaction date window.
 * @param day - The bound day.
 * @param operator - How the transaction date compares to it.
 * @returns Transaction-list filter.
 */
function dayFilter(day: IYahavNativeDay, operator: string): VarsMap {
  const date = { Ver: 'Date_1.0.0', Year: day.year, Month: day.month, Day: day.day };
  return { Ver: 'TransactionListFilter_1.0.0', OrigDt: date, Operator: operator };
}

/**
 * The balance read for one current account.
 * @param refs - The account and its portfolio.
 * @returns Balance payload.
 */
function yahavBalancePayload(refs: IYahavAccountRefs): VarsMap {
  const kind = { Ver: 'DemandDepositAccount_1.0.0', Type: { CDE: 'DDA' }, Currency: ILS_CURRENCY };
  const terms = { Use: { CDE: 'BUSINESS' }, OpenDt: yahavArchetype('Date_1.0.0') };
  const entity = {
    ...kind,
    ...terms,
    BalanceList: BALANCE_LIST,
    AccountId: accountId(refs.account),
  };
  const portfolioRefs = yahavPortfolioRefs(refs.portfolio);
  return yahavInquiry(entity, { RefDataList: portfolioRefs });
}

/**
 * The transaction read for one current account over an inclusive window.
 * @param args - The account, its portfolio and the window.
 * @returns Transactions payload.
 */
function yahavTxnsPayload(args: IYahavTxnsArgs): VarsMap {
  const from = dayFilter(args.from, 'GREATERTHANOREQUAL');
  const to = dayFilter(args.to, 'LESSTHANOREQUAL');
  const entity = { Ver: 'Transaction_1.0.0', AccountId: accountId(args.account) };
  const refs = yahavPortfolioRefs(args.portfolio);
  const filters = [{ Ver: 'ANDFilter_1.0.0', Filters: [from, to] }];
  const rest = { Category: ['CURRENT_ACCOUNT'], RefDataList: refs, Filters: filters };
  return yahavInquiry(entity, rest);
}

export type { IYahavAccountRefs, IYahavNativeDay, IYahavTxnsArgs };
export { yahavBalancePayload, yahavTxnsPayload };
