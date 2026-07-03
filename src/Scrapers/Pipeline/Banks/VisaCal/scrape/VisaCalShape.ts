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

import type { IApiDirectScrapeShape } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
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

/** VisaCal hard-model shape — passed to `.withBrowserApiDirect(...)`. */
const VISACAL_SHAPE: IApiDirectScrapeShape<IVisaCalCard, number> = {
  stepName: 'VisaCalScrape',
  accountNumberOf,
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

export default VISACAL_SHAPE;
export { VISACAL_SHAPE };
