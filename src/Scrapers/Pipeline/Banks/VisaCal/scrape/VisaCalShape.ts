/**
 * VisaCal scrape shape — the `IApiDirectScrapeShape` data declaration
 * consumed by the generic buildGenericHeadlessScrape driver via
 * `withBrowserApiDirect`. balanceKind=card-cycle (`balance.skipFetch`
 * yields a deterministic 0 — VisaCal exposes no account-level balance);
 * auth=token (the CALAuthScheme value is primed onto the mediator by the
 * BIND-API-MEDIATOR phase). Customer + transactions are POST against the
 * CAL API gateway. Helpers split across VisaCalShapeHelpers.ts and
 * VisaCalShapeTxns.ts to hold the file-size cap.
 */

import type {
  HeaderMap,
  IApiDirectScrapeShape,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import {
  accountNumberOf,
  customerUrl,
  customerVars,
  extractCards,
  type IVisaCalCard,
  noVars,
} from './VisaCalShapeHelpers.js';
import { txnsExtractPage, txnsUrl, txnsVars } from './VisaCalShapeTxns.js';

/**
 * Card-cycle balance — always 0 (VisaCal exposes no account-level
 * balance; `balance.skipFetch` bypasses the fetch, extract reads {}).
 * Module-private so it never crosses a boundary (architecture Rule #15).
 * @returns Zero balance.
 */
function balanceZero(): number {
  return 0;
}

/**
 * CAL API JSON request headers. The gateway rejects a JSON POST that omits
 * a `content-type` with a 400 (empty body), even when the Authorization
 * token is valid; the mediator merges the primed Authorization on top of
 * these, so declaring `content-type` is the only missing piece. Grounded in
 * run 04-07-2026_19080354: account/init with headerNames=["authorization"]
 * (no content-type) returned 400, while the SPA's own init with the same
 * body {"tokenGuid":""} returned 200 accounts.
 * @returns CAL API JSON request headers.
 */
function jsonHeaders(): HeaderMap {
  return { 'content-type': 'application/json', accept: 'application/json' };
}

/** VisaCal hard-model shape — passed to `.withBrowserApiDirect(...)`. */
const VISACAL_SHAPE: IApiDirectScrapeShape<IVisaCalCard, number> = {
  stepName: 'VisaCalScrape',
  accountNumberOf,
  customer: {
    buildVars: customerVars,
    extractAccounts: extractCards,
    urlTag: customerUrl,
    method: 'POST',
    extraHeaders: jsonHeaders,
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
    extraHeaders: jsonHeaders,
  },
};

export default VISACAL_SHAPE;
export { VISACAL_SHAPE };
