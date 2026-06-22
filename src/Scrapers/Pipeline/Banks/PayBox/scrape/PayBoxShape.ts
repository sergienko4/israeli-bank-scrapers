/**
 * PayBox scrape shape — pure data declaration consumed by the generic
 * createApiDirectScrapePhase factory.
 *
 * Customer step: `skipFetch: true` — accounts synthesised from the
 * post-login session-context (uId). PayBox has no `/getAccounts`
 * endpoint; the login already gives us everything we need.
 *
 * Balance step: POST `/sync` (class-y body) — same call shared by both
 * wallet + debit accounts. PayBox's `/sync` returns one `userFunds.balance`
 * for the wallet; the debit virtual card has its own balance via the
 * pre-paid float but we report the wallet balance for both
 * (debit txns deduct from the wallet — the user's mental model). The
 * balance call is signed via the shared shape-level AES signer at
 * `/auth/signature`.
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
import { payBoxEmptyResultGuard } from './PayBoxResultGuard.js';
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
  resultGuard: payBoxEmptyResultGuard,
  customer: {
    skipFetch: true,
    buildVars: customerVars,
    extractAccounts: extractAccountsFromSessionContext,
  },
  balance: {
    urlTag: 'data.sync',
    buildVars: balanceVars,
    extract: balanceExtract,
    fallbackOnFail: 0,
    retryOnTransient: { maxRetries: 2, backoffMs: 500 },
  },
  transactions: {
    urlTag: TXNS_URL_TAG,
    buildVars: txnsVars,
    extractPage: txnsExtractPage,
  },
};

export default PAYBOX_SHAPE;
export { PAYBOX_SHAPE };
