/**
 * Mercantile scrape shape — the `IApiDirectScrapeShape` data declaration
 * consumed by the generic buildGenericHeadlessScrape driver via
 * `withBrowserApiDirect`. balanceKind=account (issues a real balance
 * call); auth=session-cookie (nothing to declare — cookies ride the
 * live login page through BrowserFetchStrategy). All three Titan calls
 * are GET. Helpers split across MercantileShapeHelpers.ts (accounts +
 * balance) and MercantileShapeTxns.ts (transactions).
 *
 * Contract is identical to Discount (upstream MercantileScraper extends
 * DiscountScraper; only the `bank=m` loginUrl differs, handled by the
 * browser login phase). Cloned per the zero-cross-bank-import rule.
 */

import type { IApiDirectScrapeShape } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import {
  accountNumberOf,
  balanceExtract,
  balanceUrl,
  customerUrl,
  extractAccounts,
  type IMercantileAcct,
  noVars,
} from './MercantileShapeHelpers.js';
import { txnsExtractPage, txnsUrl, txnsVars } from './MercantileShapeTxns.js';

/** Mercantile hard-model shape — passed to `.withBrowserApiDirect(...)`. */
const MERCANTILE_SHAPE: IApiDirectScrapeShape<IMercantileAcct, never> = {
  stepName: 'MercantileScrape',
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

export default MERCANTILE_SHAPE;
export { MERCANTILE_SHAPE };
