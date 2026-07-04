/**
 * Hapoalim scrape shape — the `IApiDirectScrapeShape` data declaration
 * consumed by the generic buildGenericHeadlessScrape driver via
 * `withBrowserApiDirect`. balanceKind=account (issues a real balance
 * call); accounts + balance are cookie-authed GET (cookies ride the live
 * login page through BrowserFetchStrategy), transactions is an
 * anti-replay POST (X-XSRF-TOKEN cookie-echo + pageUuid + uuid). Helpers
 * split across HapoalimShapeHelpers.ts (accounts + balance) and
 * HapoalimShapeTxns.ts (transactions).
 *
 * Contract grounded in the captured trace
 * (C:\tmp\runs\pipeline\hapoalim\04-07-2026_03183039) and the upstream
 * `hapoalim.ts` recipe. Replaces the generic
 * AUTH-DISCOVERY/ACCOUNT-RESOLVE/DASHBOARD chain.
 */

import type { IApiDirectScrapeShape } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import {
  accountNumberOf,
  balanceExtract,
  balanceUrl,
  customerUrl,
  extractAccounts,
  type IHapoalimAcct,
  noVars,
} from './HapoalimShapeHelpers.js';
import { txnsExtractPage, txnsHeaders, txnsUrl, txnsVars } from './HapoalimShapeTxns.js';

/** Hapoalim hard-model shape — passed to `.withBrowserApiDirect(...)`. */
const HAPOALIM_SHAPE: IApiDirectScrapeShape<IHapoalimAcct, never> = {
  stepName: 'HapoalimScrape',
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
    method: 'POST',
    extraHeaders: txnsHeaders,
  },
};

export default HAPOALIM_SHAPE;
export { HAPOALIM_SHAPE };
