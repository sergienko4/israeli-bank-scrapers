/**
 * PayBox scrape shape — pure data declaration consumed by the generic
 * createApiDirectScrapePhase factory.
 *
 * Customer step: `skipFetch: true` — accounts synthesised from the
 * post-login session-context (uId). PayBox has no `/getAccounts`
 * endpoint; the login already gives us everything we need.
 *
 * Balance step: SKIPPED (`skipFetch: true`). PayBox's `/sync` answers
 * HTTP 400 for every body shape tried, so it never yields a balance —
 * and the rejection poisons the session: `/getUserHistory` then answers
 * `401 UNAUTHORIZED` within ~200 ms. Removing the `auth` envelope from
 * its body was not enough (the 400 alone suffices), so the call is not
 * made at all and `balanceExtract` runs against `{}` for a deterministic
 * 0. See {@link balanceVars} for the forensic trail.
 *
 * Transactions step: dispatches per acct.kind via the function-form
 * `urlTag` (wallet → /getUserHistory, debit → /virtualCardTranRequest).
 * Body is the full hydrated object from `buildVars` (no `bodyTemplate`)
 * because the two endpoints take incompatible field sets.
 *
 * Helpers split into PayBoxShapeHelpers.ts (customer/balance) +
 * PayBoxShapeTxns.ts (per-acct routing + pagination).
 */

import type { IApiDirectScrapeShape } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import {
  PAYBOX_SCRAPE_SIGNER,
  PAYBOX_SECRETS,
} from '../../../Registry/Config/PipelineBankConfigPayBoxCrypto.js';
import { extractHmacKeyPatch, getKeyVars } from './PayBoxBootstrap.js';
import { payBoxResultGuard } from './PayBoxResultGuard.js';
import {
  accountNumberOf,
  balanceExtract,
  balanceVars,
  customerVars,
  extractAccountsFromSessionContext,
  type IPayBoxAcct,
} from './PayBoxShapeHelpers.js';
import { type IPayBoxCursor, TXNS_URL_TAG, txnsExtractPage, txnsVars } from './PayBoxShapeTxns.js';

/** PayBox shape declaration — plugged into createApiDirectScrapePhase. */
const PAYBOX_SHAPE: IApiDirectScrapeShape<IPayBoxAcct, IPayBoxCursor> = {
  stepName: 'PayBoxScrape',
  signer: PAYBOX_SCRAPE_SIGNER,
  secrets: PAYBOX_SECRETS,
  accountNumberOf,
  bootstrap: {
    urlTag: 'data.getKey',
    buildVars: getKeyVars,
    extractPatch: extractHmacKeyPatch,
  },
  customer: {
    skipFetch: true,
    buildVars: customerVars,
    extractAccounts: extractAccountsFromSessionContext,
  },
  balance: {
    urlTag: 'data.sync',
    skipFetch: true,
    buildVars: balanceVars,
    extract: balanceExtract,
    fallbackOnFail: 0,
  },
  transactions: {
    urlTag: TXNS_URL_TAG,
    buildVars: txnsVars,
    extractPage: txnsExtractPage,
    windowNarrowing: 'providerCursor',
  },
  resultGuard: payBoxResultGuard,
};

export default PAYBOX_SHAPE;
export { PAYBOX_SHAPE };
