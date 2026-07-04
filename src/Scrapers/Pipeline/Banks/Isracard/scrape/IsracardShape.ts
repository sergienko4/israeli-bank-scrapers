/**
 * Isracard scrape shape — the `IApiDirectScrapeShape` data declaration
 * consumed by the generic buildGenericHeadlessScrape driver via
 * `withBrowserApiDirect`. balanceKind=card-cycle (`balance.skipFetch`
 * yields a deterministic 0 — Isracard exposes no account-level balance);
 * auth=session-cookie (the browser login's first-party cookies ride
 * BrowserFetchStrategy — no token prime). A post-login `prime` nav to the
 * transactions SPA route establishes the separate transactions-service
 * session (the login cookies alone only authorize the statuspage service).
 * Customer + transactions are POST against the Isracard DigitalV3 API
 * (base-isracard-amex backbone, host web.isracard.co.il). Helpers split
 * across IsracardShapeHelpers.ts, IsracardShapeTxns.ts and
 * IsracardShapeExtract.ts to hold the file-size cap.
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
  type IIsracardCard,
  noVars,
  primeUrl,
} from './IsracardShapeHelpers.js';
import { txnsExtractPage, txnsUrl, txnsVars } from './IsracardShapeTxns.js';

/**
 * Card-cycle balance — always 0 (Isracard exposes no account-level balance;
 * `balance.skipFetch` bypasses the fetch, extract reads {}). Module-private
 * so it never crosses a boundary (architecture Rule #15).
 * @returns Zero balance.
 */
function balanceZero(): number {
  return 0;
}

/**
 * DigitalV3 JSON request headers. The transactions API returns an HTML login
 * page (302→200) for a POST that omits a JSON `content-type`; the browser
 * auto-attaches same-origin Origin/Referer after the `prime` nav lands the
 * page on web.isracard.co.il, so `content-type` is the only header the
 * replayed POST must declare. Grounded in run 04-07-2026_19124438:
 * GetCardList with headerNames=[] returned 302→text/html, matching the Amex
 * DigitalV3 backbone the two banks share.
 * @returns DigitalV3 JSON request headers.
 */
function digitalV3Headers(): HeaderMap {
  return { 'content-type': 'application/json', accept: 'application/json' };
}

/** Isracard hard-model shape — passed to `.withBrowserApiDirect(...)`. */
const ISRACARD_SHAPE: IApiDirectScrapeShape<IIsracardCard, number> = {
  stepName: 'IsracardScrape',
  accountNumberOf,
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
    urlTag: txnsUrl,
    method: 'POST',
    extraHeaders: digitalV3Headers,
  },
};

export default ISRACARD_SHAPE;
export { ISRACARD_SHAPE };
