/**
 * Discount scrape shape — the `IApiDirectScrapeShape` data declaration
 * consumed by the generic buildGenericHeadlessScrape driver via
 * `withApiDirect`. balanceKind=account (issues a real balance call). Auth =
 * the session cookies the API-DIRECT-CALL login set, kept by the node
 * transport, + the routing headers every Titan call echoes from them
 * ({@link titanHeaders}); balance and transactions name their account in
 * `accountnumber`. Every answer passes {@link checkTitanBody} first. All
 * three Titan calls are GET. Helpers split across DiscountShapeHelpers.ts
 * (accounts + balance + headers), DiscountShapeTxns.ts (transactions) and
 * DiscountShapeCheck.ts (the answer check).
 */

import type { IApiDirectScrapeShape } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { checkTitanBody } from './DiscountShapeCheck.js';
import {
  accountNumberOf,
  balanceExtract,
  balanceUrl,
  callAccountIdOf,
  customerUrl,
  extractAccounts,
  type IDiscountAcct,
  noVars,
  titanHeaders,
} from './DiscountShapeHelpers.js';
import { txnsExtractPage, txnsUrl, txnsVars } from './DiscountShapeTxns.js';

/** Discount hard-model shape — passed to `.withApiDirect(...)`. */
const DISCOUNT_SHAPE: IApiDirectScrapeShape<IDiscountAcct, never> = {
  stepName: 'DiscountScrape',
  accountNumberOf,
  callAccountIdOf,
  checkBody: checkTitanBody,
  customer: {
    buildVars: noVars,
    extractAccounts,
    urlTag: customerUrl,
    method: 'GET',
    extraHeaders: titanHeaders,
  },
  balance: {
    buildVars: noVars,
    extract: balanceExtract,
    urlTag: balanceUrl,
    method: 'GET',
    extraHeaders: titanHeaders,
  },
  transactions: {
    buildVars: txnsVars,
    extractPage: txnsExtractPage,
    windowNarrowing: 'lowerBoundOnly',
    urlTag: txnsUrl,
    method: 'GET',
    extraHeaders: titanHeaders,
  },
};

export default DISCOUNT_SHAPE;
export { DISCOUNT_SHAPE };
