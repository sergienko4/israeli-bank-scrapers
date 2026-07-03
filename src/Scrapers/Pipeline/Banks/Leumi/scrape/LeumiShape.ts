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

import type { IApiDirectScrapeShape } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
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

/** Leumi hard-model shape — passed to `.withBrowserApiDirect(...)`. */
const LEUMI_SHAPE: IApiDirectScrapeShape<ILeumiAcct, never> = {
  stepName: 'LeumiScrape',
  accountNumberOf,
  customer: {
    buildVars: customerVars,
    extractAccounts,
    urlTag: leumiBrokerUrl(GET_ACCOUNTS_MODULE),
    method: 'POST',
  },
  balance: {
    buildVars: balanceVars,
    extract: balanceExtract,
    urlTag: leumiBrokerUrl(UC_SO_27_MODULE),
    method: 'POST',
  },
  transactions: {
    buildVars: txnsVars,
    extractPage: txnsExtractPage,
    urlTag: leumiBrokerUrl(UC_SO_27_MODULE),
    method: 'POST',
  },
};

export default LEUMI_SHAPE;
export { LEUMI_SHAPE };
