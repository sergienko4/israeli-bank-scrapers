/**
 * Max scrape shape — the `IApiDirectScrapeShape` data declaration consumed by
 * the generic buildGenericHeadlessScrape driver via `withBrowserApiDirect`.
 * balanceKind=card-cycle (`balance.skipFetch` yields a deterministic 0 — Max
 * exposes no account-level balance); auth=session-cookie (the browser login's
 * first-party cookies ride BrowserFetchStrategy — no token prime). Customer +
 * transactions are GET against the Max registered API (params ride the URL,
 * including the SPA `?v=` build version discovered at BIND-API-MEDIATOR).
 * Helpers split across MaxShapeHelpers.ts, MaxShapeTxns.ts and
 * MaxShapeExtract.ts to hold the file-size cap.
 */

import type { IApiDirectScrapeShape } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import {
  accountNumberOf,
  customerUrl,
  extractCards,
  type IMaxCard,
  noVars,
} from './MaxShapeHelpers.js';
import { txnsExtractPage, txnsUrl } from './MaxShapeTxns.js';

/**
 * Card-cycle balance — always 0 (Max exposes no account-level balance;
 * `balance.skipFetch` bypasses the fetch, extract reads {}). Module-private
 * so it never crosses a boundary (architecture Rule #15).
 * @returns Zero balance.
 */
function balanceZero(): number {
  return 0;
}

/** Max hard-model shape — passed to `.withBrowserApiDirect(...)`. */
const MAX_SHAPE: IApiDirectScrapeShape<IMaxCard, number> = {
  stepName: 'MaxScrape',
  accountNumberOf,
  customer: {
    buildVars: noVars,
    extractAccounts: extractCards,
    urlTag: customerUrl,
    method: 'GET',
  },
  balance: {
    buildVars: noVars,
    extract: balanceZero,
    skipFetch: true,
  },
  transactions: {
    buildVars: noVars,
    extractPage: txnsExtractPage,
    urlTag: txnsUrl,
    method: 'GET',
  },
};

export default MAX_SHAPE;
export { MAX_SHAPE };
