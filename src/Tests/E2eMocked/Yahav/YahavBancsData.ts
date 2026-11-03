/**
 * Yahav mocked BaNCS entities: the portfolios the
 * customer holds, the accounts in the default one, their balances and their
 * movements. Each answer also carries entities the scrape must pass over — a
 * second portfolio, a foreign-currency account, the other accounts' balances
 * and a stranger's movement — so a green run proves the selection.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import type { JsonUnknownRecord } from '../../../Scrapers/Pipeline/Types/JsonValue.js';
import type { IYahavMockAccount } from './YahavMockData.js';
import {
  daysAgo,
  YH_ACCOUNTS,
  YH_PORTFOLIO,
  YH_TXN_AMOUNTS,
  YH_TXN_DAYS,
} from './YahavMockData.js';

/** One BaNCS calendar day. */
export interface IBancsDay {
  readonly Year: number;
  readonly Month: number;
  readonly Day: number;
}

/** An account no list holds: its movements must never reach a result. */
const STRANGER: IYahavMockAccount = { id: 'SYN-acct-9', number: 'SYN-900900', balance: '0' };

/** The days a transactions call asks for, inclusive. */
export interface IBancsWindow {
  readonly from: string;
  readonly to: string;
}

/**
 * The reference the accounts list gives an account.
 * @param id - Account id.
 * @returns Its object reference.
 */
export function iorOf(id: string): string {
  return `${id}-ior`;
}

/**
 * An account identifier as the bank writes it.
 * @param account - The account.
 * @param iorSuffix - Appended to the account's object reference in this answer.
 * @returns The identifier.
 */
function accountIdOf(account: IYahavMockAccount, iorSuffix = ''): JsonUnknownRecord {
  const id = { Ver: 'Identifier_1.0.0', Id: account.id };
  const iorId = `${iorOf(account.id)}${iorSuffix}`;
  return {
    Ver: 'AccountIdentifier_1.0.0',
    Id: id,
    iorId,
    AcctIds: { BANKACCOUNTID: account.number },
  };
}

/**
 * A portfolio relationship.
 * @param id - Portfolio id; its reference is derived.
 * @param isDefault - Whether it is the customer's default.
 * @returns The entity.
 */
function portfolioOf(id: string, isDefault: boolean): JsonUnknownRecord {
  const iorId = id === YH_PORTFOLIO.id ? YH_PORTFOLIO.iorId : iorOf(id);
  const portfolio = { Ver: 'Portfolio_1.0.0', Id: { Id: id, iorId } };
  return {
    Ver: 'CustomerPortfolioRelationship_1.0.0.BY.1.0',
    DefPortfolioInd: isDefault,
    Prtflio: portfolio,
  };
}

/**
 * The customer's portfolios: a non-default one first, then the default.
 * @returns The portfolio entities.
 */
export function portfolioEntities(): readonly JsonUnknownRecord[] {
  return [portfolioOf('SYN-pf-1', false), portfolioOf(YH_PORTFOLIO.id, true)];
}

/**
 * A current account in the default portfolio.
 * @param account - The account.
 * @param currency - Its currency code.
 * @returns The relationship entity.
 */
function accountEntityOf(account: IYahavMockAccount, currency: string): JsonUnknownRecord {
  const kind = { Type: { CDE: 'DDA' }, Currency: { Code: { CDE: currency } } };
  const entity = { ...kind, AccountId: accountIdOf(account) };
  return { Ver: 'PortfolioAccountRelationship_1.0.0', Account: entity };
}

/**
 * The default portfolio's accounts, and a dollar account the scrape skips.
 * @returns The account entities.
 */
export function accountEntities(): readonly JsonUnknownRecord[] {
  const shekel = YH_ACCOUNTS.map(account => accountEntityOf(account, 'ILS'));
  const dollar = accountEntityOf({ id: 'SYN-acct-usd', number: 'SYN-300', balance: '0' }, 'USD');
  return [...shekel, dollar];
}

/**
 * An account's balances: an available figure, then the current one.
 * @param account - The account; the answer rotates its object reference.
 * @returns The balance entity.
 */
function balanceEntityOf(account: IYahavMockAccount): JsonUnknownRecord {
  const available = { BalType: { CDE: 'AVAILABLE' }, CurrAmt: { Amt: { Value: '999999.99' } } };
  const current = { BalType: { CDE: 'CURRENT' }, CurrAmt: { Amt: { Value: account.balance } } };
  const accountId = accountIdOf(account, '-rotated');
  return {
    Ver: 'DemandDepositAccount_1.0.0',
    AccountId: accountId,
    BalanceList: [available, current],
  };
}

/**
 * Every account's balance, the asked-for one last.
 * @returns The balance entities.
 */
export function balanceEntities(): readonly JsonUnknownRecord[] {
  return YH_ACCOUNTS.map(balanceEntityOf).reverse();
}

/**
 * A day as BaNCS writes it.
 * @param date - Midnight UTC of the day.
 * @returns The calendar day.
 */
function bancsDayOf(date: Date): IBancsDay {
  return { Year: date.getUTCFullYear(), Month: date.getUTCMonth() + 1, Day: date.getUTCDate() };
}

/**
 * A BaNCS day as `YYYY-MM-DD`, for range checks.
 * @param day - The calendar day.
 * @returns Its ISO day.
 */
export function isoDayOf(day: IBancsDay): string {
  const month = String(day.Month).padStart(2, '0');
  return `${String(day.Year)}-${month}-${String(day.Day).padStart(2, '0')}`;
}

/**
 * One movement of an account.
 * @param account - The account.
 * @param index - Which of the synthetic movements.
 * @returns The transaction row.
 */
function txnRowOf(account: IYahavMockAccount, index: number): JsonUnknownRecord {
  const amount = YH_TXN_AMOUNTS[index];
  const movedOn = daysAgo(YH_TXN_DAYS[index]);
  const day = bancsDayOf(movedOn);
  const type = { OthrSubTyp: amount.startsWith('-') ? 'payment' : 'inpymntord' };
  const value = { Amt: { Value: amount.replace('-', '') }, CurrCode: { CDE: 'ILS' } };
  const ids = { TxnIds: { TRANSACTIONID: `SYN-txn-${account.id}-${String(index)}` } };
  const head = { Ver: 'Transaction_1.0.0', AccountId: accountIdOf(account) };
  const memo = `SYN movement ${String(index)} of ${account.id}`;
  return {
    ...head,
    OrigDt: { Ver: 'Date_1.0.0', ...day },
    TotalCurAmt: value,
    Memo: memo,
    TxnType: type,
    TxnId: ids,
  };
}

/**
 * Every account's movements (a stranger's too) dated within a window.
 * @param window - The days asked for.
 * @returns The transaction rows.
 */
export function txnRows(window: IBancsWindow): readonly JsonUnknownRecord[] {
  const accounts = [...YH_ACCOUNTS, STRANGER];
  const rows = accounts.flatMap(account => YH_TXN_DAYS.map((_, index) => txnRowOf(account, index)));
  return rows.filter(row => {
    const iso = isoDayOf(row.OrigDt as IBancsDay);
    return iso >= window.from && iso <= window.to;
  });
}
