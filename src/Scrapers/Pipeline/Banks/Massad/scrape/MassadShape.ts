/**
 * Massad (FIBI group) scrape shape — the `IApiDirectScrapeShape` data
 * declaration consumed by the generic buildGenericHeadlessScrape driver
 * via `withBrowserApiDirect`. balanceKind=account.
 *
 * Account identity spans two cookie-authed GETs: `userData` (customer)
 * for the account number + branch, and a session-level `accountType`
 * lookup (customer.secondaryUrlTag) for the numeric type that the balance
 * path segment and the transactions body both need. Balance is a GET;
 * transactions a single full-window POST. Helpers split across
 * MassadShapeHelpers.ts (host + balance), MassadShapeAccounts.ts (identity
 * merge + identity urls), and MassadShapeTxns.ts.
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
} from './MassadShapeAccounts.js';
import { balanceExtract, balanceUrl, type IMassadAcct, noVars } from './MassadShapeHelpers.js';
import { txnsExtractPage, txnsUrl, txnsVars } from './MassadShapeTxns.js';

/** Massad hard-model shape — passed to `.withBrowserApiDirect(...)`. */
const MASSAD_SHAPE: IApiDirectScrapeShape<IMassadAcct, never> = {
  stepName: 'MassadScrape',
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

export default MASSAD_SHAPE;
export { MASSAD_SHAPE };
