/**
 * VisaCal scrape shape — the `IApiDirectScrapeShape` data declaration
 * consumed by the generic headless scrape driver via `withApiDirect`.
 * balanceKind=card-cycle: each card's balance is its next ILS debit, one
 * frames POST per card. auth=token (the login flow installs the
 * `CALAuthScheme` Authorization on the mediator). Customer, balance and
 * transactions are POSTs against the CAL web gateway. Helpers split across
 * VisaCalShapeHelpers.ts, VisaCalShapeBalance.ts and VisaCalShapeTxns.ts to
 * hold the file-size cap.
 */

import {
  BALANCE_UNKNOWN,
  type HeaderMap,
  type IApiDirectScrapeShape,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import {
  balanceIsAbsent,
  balanceUrl,
  balanceVars,
  nextTotalDebitOf,
} from './VisaCalShapeBalance.js';
import {
  accountNumberOf,
  CAL_WEB_SITE_ID,
  customerUrl,
  customerVars,
  extractCards,
  type IVisaCalCard,
} from './VisaCalShapeHelpers.js';
import { txnsExtractPage, txnsUrl, txnsVars, validatePlan } from './VisaCalShapeTxns.js';

/**
 * CAL web-gateway JSON request headers. The gateway answers a JSON POST that
 * omits `content-type` with a 400 (empty body), even when the token is valid.
 * `x-site-id` is the identifier CAL's own web app sends; with no browser to
 * supply it, the Shape declares it. The mediator adds the `CALAuthScheme`
 * Authorization on top. Names are lowercase so they replace, rather than sit
 * beside, the transport's default `content-type`.
 * @returns CAL web-gateway JSON request headers.
 */
function jsonHeaders(): HeaderMap {
  return {
    'content-type': 'application/json',
    accept: 'application/json',
    'x-site-id': CAL_WEB_SITE_ID,
  };
}

/** VisaCal hard-model shape — passed to `.withApiDirect(...)`. */
const VISACAL_SHAPE: IApiDirectScrapeShape<IVisaCalCard, number> = {
  stepName: 'VisaCalScrape',
  accountNumberOf,
  // A card issuer: charges arrive positive and the mapper flips them.
  isCardIssuer: true,
  customer: {
    buildVars: customerVars,
    extractAccounts: extractCards,
    urlTag: customerUrl,
    method: 'POST',
    extraHeaders: jsonHeaders,
  },
  balance: {
    buildVars: balanceVars,
    // CAL publishes a real figure, so an unconfirmed or malformed reply is
    // unknown, not 0.
    isAbsent: balanceIsAbsent,
    extract: nextTotalDebitOf,
    // A failed frames call keeps the cards and their transactions and
    // publishes no balance, rather than a 0 the bank never sent.
    fallbackOnFail: BALANCE_UNKNOWN,
    urlTag: balanceUrl,
    method: 'POST',
    extraHeaders: jsonHeaders,
  },
  transactions: {
    buildVars: txnsVars,
    extractPage: txnsExtractPage,
    validatePlan,
    windowNarrowing: 'periodEnumeration',
    urlTag: txnsUrl,
    method: 'POST',
    extraHeaders: jsonHeaders,
  },
};

export default VISACAL_SHAPE;
export { VISACAL_SHAPE };
