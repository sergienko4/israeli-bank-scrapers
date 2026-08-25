/**
 * Max scrape shape — the `IApiDirectScrapeShape` data declaration consumed by
 * the generic buildGenericHeadlessScrape driver via `withBrowserApiDirect`.
 * balanceKind=card-cycle: Max publishes an outstanding ILS cycle debit per
 * card on the very `getHomePageData` object the customer step already read,
 * so `balance.skipFetch` stays on and `extract` reads the account rather than
 * a response. auth=session-cookie (the browser login's first-party cookies
 * ride BrowserFetchStrategy — no token prime). Customer + transactions are
 * GET against the Max registered API (params ride the URL, including the SPA
 * `?v=` build version discovered at BIND-API-MEDIATOR). Helpers split across
 * MaxShapeHelpers.ts, MaxShapeBalance.ts, MaxShapeTxns.ts and
 * MaxShapeExtract.ts to hold the file-size cap.
 */

import type {
  ApiBody,
  IApiDirectScrapeShape,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { OWNS_MAX_ROW } from './MaxShapeExtract.js';
import {
  accountNumberOf,
  customerUrl,
  extractCards,
  type IMaxCard,
  noVars,
} from './MaxShapeHelpers.js';
import { txnsExtractPage, txnsUrl } from './MaxShapeTxns.js';

/**
 * Per-card cycle balance — the outstanding ILS debit already carried on the
 * card the customer step extracted, so the balance step stays off the network
 * (`skipFetch`) and ignores its empty body. Module-private so it never crosses
 * a boundary (architecture Rule #15).
 * @param _body - Unused; `skipFetch` yields `{}`.
 * @param card - The account being assembled.
 * @returns That card's outstanding ILS cycle debit.
 */
function cardCycleBalance(_body: ApiBody, card: IMaxCard): number {
  return card.cycleDebit;
}

/** Max hard-model shape — passed to `.withBrowserApiDirect(...)`. */
const MAX_SHAPE: IApiDirectScrapeShape<IMaxCard, number> = {
  stepName: 'MaxScrape',
  accountNumberOf,
  // A card issuer: charges arrive positive and the mapper flips them.
  isCardIssuer: true,
  customer: {
    buildVars: noVars,
    extractAccounts: extractCards,
    urlTag: customerUrl,
    method: 'GET',
  },
  balance: {
    buildVars: noVars,
    extract: cardCycleBalance,
    skipFetch: true,
  },
  transactions: {
    buildVars: noVars,
    extractPage: txnsExtractPage,
    auditOwnsRow: OWNS_MAX_ROW,
    windowNarrowing: 'periodEnumeration',
    urlTag: txnsUrl,
    method: 'GET',
  },
};

export default MAX_SHAPE;
export { MAX_SHAPE };
