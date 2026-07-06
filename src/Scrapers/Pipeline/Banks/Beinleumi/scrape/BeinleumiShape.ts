/**
 * Beinleumi (FIBI) scrape shape — the `IApiDirectScrapeShape` data
 * declaration consumed by the generic buildGenericHeadlessScrape driver
 * via `withBrowserApiDirect`. balanceKind=account.
 *
 * Account identity spans two cookie-authed GETs: `userData` (customer)
 * for the account number + branch, and a session-level `accountType`
 * lookup (customer.secondaryUrlTag) for the numeric type that the balance
 * path segment and the transactions body both need. Balance is a GET;
 * transactions a single full-window POST. Helpers split across
 * BeinleumiShapeHelpers.ts (host + balance), BeinleumiShapeAccounts.ts
 * (identity merge + identity urls), and BeinleumiShapeTxns.ts.
 *
 * Contract grounded in the captured trace
 * (C:\tmp\runs\pipeline\beinleumi\04-07-2026_11221970). Replaces the
 * generic AUTH-DISCOVERY/ACCOUNT-RESOLVE/DASHBOARD chain — the `prime` nav
 * to the appsng SPA shell replays that dropped DASHBOARD navigation so the
 * cookie-authed fetches run from the rendered app context, not FIBI's blank
 * `/wps/` portal shell.
 */

import type { IApiDirectScrapeShape } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import {
  accountNumberOf,
  customerUrl,
  extractAccounts,
  secondaryUrl,
} from './BeinleumiShapeAccounts.js';
import {
  balanceExtract,
  balanceUrl,
  type IBeinleumiAcct,
  noVars,
  primeUrl,
} from './BeinleumiShapeHelpers.js';
import { txnsExtractPage, txnsUrl, txnsVars } from './BeinleumiShapeTxns.js';

/** Beinleumi hard-model shape — passed to `.withBrowserApiDirect(...)`. */
const BEINLEUMI_SHAPE: IApiDirectScrapeShape<IBeinleumiAcct, never> = {
  stepName: 'BeinleumiScrape',
  accountNumberOf,
  prime: { navUrl: primeUrl },
  customer: {
    buildVars: noVars,
    extractAccounts,
    urlTag: customerUrl,
    secondaryUrlTag: secondaryUrl,
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
    method: 'POST',
  },
};

export default BEINLEUMI_SHAPE;
export { BEINLEUMI_SHAPE };
