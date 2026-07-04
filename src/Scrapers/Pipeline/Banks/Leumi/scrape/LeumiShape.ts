/**
 * Leumi scrape shape — the `IApiDirectScrapeShape` data declaration
 * consumed by the generic buildGenericHeadlessScrape driver via
 * `withBrowserApiDirect`. balanceKind=account (issues a real balance
 * call); auth=session-cookie + a body-borne WCF `SessionHeader.SessionID`
 * primed by BIND-API-MEDIATOR (`sessionTokenCapture`). All three calls
 * are POST to the same broker endpoint keyed by `moduleName`. Helpers
 * split across LeumiShapeEnvelope / LeumiShapeUcSo27 / LeumiShapeHelpers
 * (accounts + balance) / LeumiShapeTxns (transactions).
 */

import type {
  HeaderMap,
  IApiDirectScrapeShape,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { leumiBrokerUrl } from './LeumiShapeEnvelope.js';
import {
  accountNumberOf,
  balanceExtract,
  balanceVars,
  customerVars,
  extractAccounts,
  GET_ACCOUNTS_MODULE,
  type ILeumiAcct,
} from './LeumiShapeHelpers.js';
import { txnsExtractPage, txnsVars } from './LeumiShapeTxns.js';
import { UC_SO_27_MODULE } from './LeumiShapeUcSo27.js';

/**
 * WCF JSON request headers. The broker answers a JSON body posted without
 * a JSON `content-type` with a 400 "Request Error" HTML page; declaring the
 * content-type routes the body to the WCF JSON deserialiser. Grounded in run
 * 04-07-2026_19130361: UC_SO_GetAccounts with headerNames=[] returned 400
 * text/html, while the SPA's own captured GetAccounts (network 0051) carrying
 * the identical body returned the 200 account list. Shared by all three
 * broker calls (accounts / balance / transactions).
 */
const WCF_JSON_HEADERS: HeaderMap = {
  'content-type': 'application/json',
  accept: 'application/json',
};

/** Leumi hard-model shape — passed to `.withBrowserApiDirect(...)`. */
const LEUMI_SHAPE: IApiDirectScrapeShape<ILeumiAcct, never> = {
  stepName: 'LeumiScrape',
  accountNumberOf,
  customer: {
    buildVars: customerVars,
    extractAccounts,
    urlTag: leumiBrokerUrl(GET_ACCOUNTS_MODULE),
    method: 'POST',
    extraHeaders: WCF_JSON_HEADERS,
  },
  balance: {
    buildVars: balanceVars,
    extract: balanceExtract,
    urlTag: leumiBrokerUrl(UC_SO_27_MODULE),
    method: 'POST',
    extraHeaders: WCF_JSON_HEADERS,
  },
  transactions: {
    buildVars: txnsVars,
    extractPage: txnsExtractPage,
    urlTag: leumiBrokerUrl(UC_SO_27_MODULE),
    method: 'POST',
    extraHeaders: WCF_JSON_HEADERS,
  },
};

export default LEUMI_SHAPE;
export { LEUMI_SHAPE };
