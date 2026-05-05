/**
 * OneZero scrape shape — customer + balance extractors.
 * Transactions helpers live in OneZeroShapeTxns.ts. Split to respect
 * the 150-LOC per-file ceiling.
 */

import type { ApiBody, VarsMap } from '../../_Shared/HeadlessScrapeShape.js';

/** Display account number (portfolio num) used in scraped output. */
type AccountNumberDisplay = string;
/** Current account balance amount. */
type AccountBalance = number;

/** Per-account ref emitted by extractAccounts. */
export interface IOneZeroAcct {
  readonly portfolioId: string;
  readonly portfolioNum: string;
  readonly accountId: string;
}

interface ICustAcct {
  readonly accountId: string;
}
interface ICustPortfolio {
  readonly portfolioId: string;
  readonly portfolioNum: string;
  readonly accounts: readonly ICustAcct[];
}
interface ICustEntry {
  readonly portfolios?: readonly ICustPortfolio[];
}
interface ICustResp {
  readonly customer: readonly ICustEntry[];
}

interface IBalResp {
  readonly balance: { readonly currentAccountBalance: number };
}

/**
 * Flatten one portfolio → zero-or-one account ref (first account only).
 * @param p - Customer portfolio entry.
 * @returns Account refs (empty when the portfolio has no accounts).
 */
function firstAcct(p: ICustPortfolio): readonly IOneZeroAcct[] {
  const head = p.accounts.at(0);
  if (!head) return [];
  const ref: IOneZeroAcct = {
    portfolioId: p.portfolioId,
    portfolioNum: p.portfolioNum,
    accountId: head.accountId,
  };
  return [ref];
}

/**
 * Flatten a customer entry's portfolios into first-account refs.
 * @param c - Customer entry.
 * @returns Refs for this entry.
 */
function customerEntryAccounts(c: ICustEntry): readonly IOneZeroAcct[] {
  const portfolios = c.portfolios ?? [];
  return portfolios.flatMap(firstAcct);
}

/**
 * Flatten customer → portfolios → first-account refs.
 * @param body - Unwrapped customer response.
 * @returns Flat account ref list.
 */
export function extractAccounts(body: ApiBody): readonly IOneZeroAcct[] {
  const resp = body as unknown as ICustResp;
  return resp.customer.flatMap(customerEntryAccounts);
}

/**
 * accountNumberOf — map ref to display portfolio number.
 * @param acct - Account ref.
 * @returns Portfolio display number.
 */
export function accountNumberOf(acct: IOneZeroAcct): AccountNumberDisplay {
  return acct.portfolioNum;
}

/**
 * Customer vars builder — customer query takes no variables.
 * @returns Empty variables map.
 */
export function customerVars(): VarsMap {
  return {};
}

/**
 * Balance vars builder.
 * @param acct - Account ref.
 * @returns Variables map.
 */
export function balanceVars(acct: IOneZeroAcct): VarsMap {
  return { portfolioId: acct.portfolioId, accountId: acct.accountId };
}

/**
 * Balance extractor.
 * @param body - Unwrapped balance response.
 * @returns Current account balance.
 */
export function balanceExtract(body: ApiBody): AccountBalance {
  const resp = body as unknown as IBalResp;
  return resp.balance.currentAccountBalance;
}
