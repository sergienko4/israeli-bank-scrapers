/**
 * Amex scrape shape — the `IApiDirectScrapeShape` data declaration consumed
 * by the generic buildGenericHeadlessScrape driver via
 * `withBrowserApiDirect`. balanceKind=card-cycle (`balance.skipFetch`
 * yields a deterministic 0 — Amex exposes no account-level balance);
 * auth=session-cookie (the browser login's first-party cookies ride
 * BrowserFetchStrategy — no token prime). A post-login `prime` nav to the
 * transactions SPA route establishes the separate transactions-service
 * session (the login cookies alone only authorize the statuspage service).
 * Customer + transactions are POST against the Amex DigitalV3 API. Helpers
 * split across AmexShapeHelpers.ts, AmexShapeTxns.ts and AmexShapeExtract.ts
 * to hold the file-size cap.
 */

import type { IApiDirectScrapeShape } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import {
  accountNumberOf,
  customerUrl,
  customerVars,
  extractCards,
  type IAmexCard,
  noVars,
  primeUrl,
} from './AmexShapeHelpers.js';
import { txnsExtractPage, txnsUrl, txnsVars } from './AmexShapeTxns.js';

/**
 * Card-cycle balance — always 0 (Amex exposes no account-level balance;
 * `balance.skipFetch` bypasses the fetch, extract reads {}). Module-private
 * so it never crosses a boundary (architecture Rule #15).
 * @returns Zero balance.
 */
function balanceZero(): number {
  return 0;
}

/** Amex hard-model shape — passed to `.withBrowserApiDirect(...)`. */
const AMEX_SHAPE: IApiDirectScrapeShape<IAmexCard, number> = {
  stepName: 'AmexScrape',
  accountNumberOf,
  prime: { navUrl: primeUrl },
  customer: {
    buildVars: customerVars,
    extractAccounts: extractCards,
    urlTag: customerUrl,
    method: 'POST',
  },
  balance: {
    buildVars: noVars,
    extract: balanceZero,
    skipFetch: true,
  },
  transactions: {
    buildVars: txnsVars,
    extractPage: txnsExtractPage,
    urlTag: txnsUrl,
    method: 'POST',
  },
};

export default AMEX_SHAPE;
export { AMEX_SHAPE };
