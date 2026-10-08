/**
 * Mizrahi scrape shape — the `IApiDirectScrapeShape` data declaration
 * consumed by the generic buildGenericHeadlessScrape driver via
 * `withBrowserApiDirect`. Auth = session cookie + the `mizrahixsrftoken`
 * header, which BIND-API-MEDIATOR replays on every call through the
 * discovered-header bag (config `installDiscoveredHeaders`, plan D14) —
 * so the shape declares no headers of its own.
 *
 * <p>Calls: `SkyBL/logon` lists every account (customer); per account,
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
  customerUrl,
  customerVars,
  extractAccounts,
  type IMizrahiAcct,
} from './MizrahiShapeHelpers.js';
import {
  type IMizrahiCursor,
  IS_MIZRAHI_TXN_ROW,
  txnsExtractPage,
  txnsUrl,
  txnsVars,
} from './MizrahiShapeTxns.js';

/** Mizrahi hard-model shape — passed to `.withBrowserApiDirect(...)`. */
const MIZRAHI_SHAPE: IApiDirectScrapeShape<IMizrahiAcct, IMizrahiCursor> = {
  stepName: 'MizrahiScrape',
  accountNumberOf,
  customer: {
    buildVars: customerVars,
    extractAccounts,
    urlTag: customerUrl(),
    method: 'POST',
  },
  balance: {
    buildVars: balanceVars,
    extract: balanceExtract,
    isAbsent: balanceIsAbsent,
    urlTag: balanceUrl(),
    method: 'POST',
  },
  transactions: {
    buildVars: txnsVars,
    extractPage: txnsExtractPage,
    windowNarrowing: 'windowEnd',
    auditIsTxnRow: IS_MIZRAHI_TXN_ROW,
    urlTag: txnsUrl(),
    method: 'POST',
  },
};

export default MIZRAHI_SHAPE;
export { MIZRAHI_SHAPE };
