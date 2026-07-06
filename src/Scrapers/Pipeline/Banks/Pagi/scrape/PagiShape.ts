/**
 * Pagi (FIBI group) scrape shape — the `IApiDirectScrapeShape` data
 * declaration consumed by the generic buildGenericHeadlessScrape driver
 * via `withBrowserApiDirect`. balanceKind=account.
 *
 * Account identity spans two cookie-authed GETs: `userData` (customer)
 * for the account number + branch, and a session-level `accountType`
 * lookup (customer.secondaryUrlTag) for the numeric type that the balance
 * path segment and the transactions body both need. Balance is a GET;
 * transactions a single full-window POST. Helpers split across
 * PagiShapeHelpers.ts (host + balance), PagiShapeAccounts.ts (identity
 * merge + identity urls), and PagiShapeTxns.ts.
 *
 * Contract shared with Beinleumi (same FIBI Mataf portal); cloned per the
 * zero-cross-bank-import convention. Grounded in the captured trace
 * (C:\tmp\runs\pipeline\beinleumi\04-07-2026_11221970). Replaces the
 * generic AUTH-DISCOVERY/ACCOUNT-RESOLVE/DASHBOARD chain.
 */

import type { IApiDirectScrapeShape } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import {
  accountNumberOf,
  customerUrl,
  extractAccounts,
  secondaryUrl,
} from './PagiShapeAccounts.js';
import { balanceExtract, balanceUrl, type IPagiAcct, noVars } from './PagiShapeHelpers.js';
import { txnsExtractPage, txnsUrl, txnsVars } from './PagiShapeTxns.js';

/** Pagi hard-model shape — passed to `.withBrowserApiDirect(...)`. */
const PAGI_SHAPE: IApiDirectScrapeShape<IPagiAcct, never> = {
  stepName: 'PagiScrape',
  accountNumberOf,
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

export default PAGI_SHAPE;
export { PAGI_SHAPE };
