/**
 * Mizrahi scrape shape — the `IApiDirectScrapeShape` data declaration
 * consumed by the generic buildGenericHeadlessScrape driver via
 * `withApiDirect`. Auth = the session cookies the API-DIRECT-CALL login set,
 * kept by the node transport, + the `mizrahixsrftoken` header every data
 * call sends ({@link mizrahiHeaders}).
 *
 * <p>Calls: the login's `SkyBL/logon` reply already lists every account, so
 * the customer step makes no call; per account,
 * `SkyBL/changeAccount` switches the session to it and returns its balance,
 * then `SkyOSH/get428Index` returns the window's movements, 50 rows a page
 * (plan D17).
 * Helpers split across MizrahiShapeHelpers (accounts), MizrahiShapeBalance
 * (switch + balance) and MizrahiShapeTxns (transactions).
 */

import type { IApiDirectScrapeShape } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { balanceExtract, balanceIsAbsent, balanceUrl, balanceVars } from './MizrahiShapeBalance.js';
import {
  accountNumberOf,
  extractAccounts,
  type IMizrahiAcct,
  mizrahiHeaders,
  noVars,
} from './MizrahiShapeHelpers.js';
import {
  type IMizrahiCursor,
  IS_MIZRAHI_TXN_ROW,
  txnsExtractPage,
  txnsUrl,
  txnsVars,
} from './MizrahiShapeTxns.js';

/** Mizrahi hard-model shape — passed to `.withApiDirect(...)`. */
const MIZRAHI_SHAPE: IApiDirectScrapeShape<IMizrahiAcct, IMizrahiCursor> = {
  stepName: 'MizrahiScrape',
  accountNumberOf,
  customer: {
    buildVars: noVars,
    extractAccounts,
    skipFetch: true,
  },
  balance: {
    buildVars: balanceVars,
    extract: balanceExtract,
    isAbsent: balanceIsAbsent,
    urlTag: balanceUrl(),
    method: 'POST',
    extraHeaders: mizrahiHeaders,
  },
  transactions: {
    buildVars: txnsVars,
    extractPage: txnsExtractPage,
    windowNarrowing: 'windowEnd',
    auditIsTxnRow: IS_MIZRAHI_TXN_ROW,
    urlTag: txnsUrl(),
    method: 'POST',
    extraHeaders: mizrahiHeaders,
  },
};

export default MIZRAHI_SHAPE;
export { MIZRAHI_SHAPE };
