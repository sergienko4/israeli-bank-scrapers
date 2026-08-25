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

import type {
  HeaderMap,
  IApiDirectScrapeShape,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { AMEX_DECLARED_ROWS } from './AmexShapeExtract.js';
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
 * Card-cycle balance — a deliberate 0, not a missing implementation.
 *
 * Amex's only billing figure is `GetBillingsForMonthsOverview`, whose
 * `data[]` rows are one per BILLING MONTH carrying
 * `billingAmounts.billingAmountIls/Usd/Eur`. The request submits every card
 * at once and the response carries no card dimension at all, so the figure
 * is a household total that cannot be attributed to the single card this
 * account represents. Adopting it would report the same total on every card
 * and silently multiply the user's debt by their card count; the 0 sentinel
 * is honest by comparison. Per-card `GetTransactionsList` likewise offers
 * only `approvals.totalEstimatedAmount` — pending approvals, not a balance.
 *
 * Contrast Max, which publishes a genuine per-card cycle debit on the card
 * object itself and therefore does resolve a real balance.
 *
 * Module-private so it never crosses a boundary (architecture Rule #15).
 * @returns Zero balance.
 */
function balanceZero(): number {
  return 0;
}

/**
 * DigitalV3 JSON request headers. The transactions API returns an HTML login
 * page (302→200) for a POST that omits a JSON `content-type`; the browser
 * auto-attaches same-origin Origin/Referer after the `prime` nav, so
 * `content-type` is the only header the replayed POST must declare. Grounded
 * in run 04-07-2026_19075796: GetCardList with headers=[] returned HTML,
 * while the SPA's own captured GetCardList (network 0084) carrying a JSON
 * content-type returned the 200 card list.
 * @returns DigitalV3 JSON request headers.
 */
function digitalV3Headers(): HeaderMap {
  return { 'content-type': 'application/json', accept: 'application/json' };
}

/** Amex hard-model shape — passed to `.withBrowserApiDirect(...)`. */
const AMEX_SHAPE: IApiDirectScrapeShape<IAmexCard, number> = {
  stepName: 'AmexScrape',
  accountNumberOf,
  // A card issuer: charges arrive positive and the mapper flips them.
  isCardIssuer: true,
  prime: { navUrl: primeUrl },
  customer: {
    buildVars: customerVars,
    extractAccounts: extractCards,
    urlTag: customerUrl,
    method: 'POST',
    extraHeaders: digitalV3Headers,
  },
  balance: {
    buildVars: noVars,
    extract: balanceZero,
    skipFetch: true,
  },
  transactions: {
    buildVars: txnsVars,
    extractPage: txnsExtractPage,
    windowNarrowing: 'periodEnumeration',
    urlTag: txnsUrl,
    method: 'POST',
    extraHeaders: digitalV3Headers,
    declaredRowSpecs: AMEX_DECLARED_ROWS,
  },
};

export default AMEX_SHAPE;
export { AMEX_SHAPE };
