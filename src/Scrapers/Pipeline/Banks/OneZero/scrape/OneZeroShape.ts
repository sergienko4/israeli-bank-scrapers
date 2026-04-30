/**
 * OneZero scrape shape — pure data declaration consumed by the generic
 * buildGenericHeadlessScrape driver. String cursor (GraphQL cursor),
 * balance falls back to 0, stops when the oldest movement predates
 * the resolved startDate window. Helpers split into
 * OneZeroShapeHelpers.ts (customer/balance) + OneZeroShapeTxns.ts.
 */

import type { IHeadlessScrapeShape } from '../../_Shared/HeadlessScrapeShape.js';
import {
  accountNumberOf,
  balanceExtract,
  balanceVars,
  customerVars,
  extractAccounts,
  type IOneZeroAcct,
} from './OneZeroShapeHelpers.js';
import { stopPredicate, txnsExtractPage, txnsVars } from './OneZeroShapeTxns.js';

/** OneZero shape declaration — passed to buildGenericHeadlessScrape. */
const ONE_ZERO_SHAPE: IHeadlessScrapeShape<IOneZeroAcct, string> = {
  stepName: 'OneZeroScrape',
  accountNumberOf,
  customer: { buildVars: customerVars, extractAccounts },
  balance: { buildVars: balanceVars, extract: balanceExtract, fallbackOnFail: 0 },
  transactions: { buildVars: txnsVars, extractPage: txnsExtractPage, stop: stopPredicate },
};

export default ONE_ZERO_SHAPE;
export { ONE_ZERO_SHAPE };
