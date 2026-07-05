/**
 * Yahav (TCS BaNCS Digital) hard-model scrape shape — the single
 * `IApiDirectScrapeShape` a browser Yahav plugs into the ApiDirectScrape
 * driver. Zero logic here: the customer (accounts), balance and transactions
 * steps compose the BaNCS `MessageEnvelope` from the portfolio refs +
 * `SecToken` captured at BIND. `balanceKind='account'` (a real portfolioBalance
 * call resolves the CURRENT balance).
 */

import type { IApiDirectScrapeShape } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { YAHAV_BALANCE, YAHAV_CUSTOMER } from './YahavShapeAccounts.js';
import type { IYahavAcct } from './YahavShapeHelpers.js';
import { YAHAV_TXNS } from './YahavShapeTxns.js';

/**
 * User-facing account number — the resolved BaNCS account id.
 * @param acct - Resolved Yahav account.
 * @returns Account id string.
 */
function accountNumberOf(acct: IYahavAcct): string {
  return acct.id;
}

/** Yahav BaNCS hard-model scrape shape. */
export const YAHAV_SHAPE: IApiDirectScrapeShape<IYahavAcct, number> = {
  stepName: 'YahavScrape',
  accountNumberOf,
  customer: YAHAV_CUSTOMER,
  balance: YAHAV_BALANCE,
  transactions: YAHAV_TXNS,
};

export default YAHAV_SHAPE;
