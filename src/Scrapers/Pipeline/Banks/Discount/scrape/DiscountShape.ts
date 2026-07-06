/**
 * Discount scrape shape — the `IApiDirectScrapeShape` data declaration
 * consumed by the generic buildGenericHeadlessScrape driver via
 * `withBrowserApiDirect`. balanceKind=account (issues a real balance
 * call); auth=session-cookie (nothing to declare — cookies ride the
 * live login page through BrowserFetchStrategy). All three Titan calls
 * are GET. Helpers split across DiscountShapeHelpers.ts (accounts +
 * balance) and DiscountShapeTxns.ts (transactions).
 */

import type { IApiDirectScrapeShape } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import {
  accountNumberOf,
  balanceExtract,
  balanceUrl,
  customerUrl,
  extractAccounts,
  type IDiscountAcct,
  noVars,
} from './DiscountShapeHelpers.js';
import { txnsExtractPage, txnsUrl, txnsVars } from './DiscountShapeTxns.js';

/** Discount hard-model shape — passed to `.withBrowserApiDirect(...)`. */
const DISCOUNT_SHAPE: IApiDirectScrapeShape<IDiscountAcct, never> = {
  stepName: 'DiscountScrape',
  accountNumberOf,
  customer: {
    buildVars: noVars,
    extractAccounts,
    urlTag: customerUrl,
    method: 'GET',
  },
  balance: {
    buildVars: noVars,
    extract: balanceExtract,
    urlTag: balanceUrl,
    method: 'GET',
  },
  transactions: {
    buildVars: txnsVars,
    extractPage: txnsExtractPage,
    urlTag: txnsUrl,
    method: 'GET',
  },
};

export default DISCOUNT_SHAPE;
export { DISCOUNT_SHAPE };
