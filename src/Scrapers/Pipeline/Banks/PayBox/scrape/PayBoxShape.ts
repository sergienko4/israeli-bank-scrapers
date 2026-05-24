/**
 * PayBox scrape shape — top-level dual-account dispatch.
 *
 * Two PayBox accounts are surfaced per scrape:
 *   wallet (kind:'wallet') — derived from /getUserHistory rows.
 *   debit  (kind:'debit')  — derived from /virtualCardTranRequest rows.
 *
 * extractAccounts synthesises exactly two TAcct values from the
 * uId echoed in the customer response body; the debit account
 * appends '-d' to the display number (spec.txt §6.6). balance
 * defaults to 0 — the per-account balance is calculated downstream
 * from txn aggregates. The transactions step dispatches by
 * acct.kind into the wallet or debit helpers (spec.txt §6.4-§6.5).
 */

import type {
  ApiBody,
  IApiDirectScrapeShape,
  VarsMap,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { IPage } from '../../../Strategy/Fetch/Pagination.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import {
  debitBuildVars,
  debitExtractPage,
  type IPayBoxDebitAcct,
  type IPayBoxDebitCursor,
} from './PayBoxShapeDebit.js';
import {
  type IPayBoxWalletAcct,
  type IPayBoxWalletCursor,
  walletBuildVars,
  walletExtractPage,
} from './PayBoxShapeWallet.js';

/** Discriminated PayBox account ref. */
export type IPayBoxAcct = IPayBoxWalletAcct | IPayBoxDebitAcct;

/** Discriminated PayBox txn cursor. */
export type IPayBoxCursor = IPayBoxWalletCursor | IPayBoxDebitCursor;

/** Body shape expected by extractAccounts — uId echoed from login carry. */
interface IPayBoxCustomerBody {
  readonly uId?: string;
}

/**
 * Synthesise the two PayBox accounts from the customer body's
 * uId echo. Returns wallet + debit refs whose accountNumber is
 * the uId (debit appends '-d' per spec.txt §6.6).
 *
 * @param body - Customer response carrying uId.
 * @returns Two-element acct list.
 */
function extractAccounts(body: ApiBody): readonly IPayBoxAcct[] {
  const resp = body as unknown as IPayBoxCustomerBody;
  const uId = resp.uId ?? '';
  const wallet: IPayBoxWalletAcct = { kind: 'wallet', accountNumber: uId };
  const debit: IPayBoxDebitAcct = { kind: 'debit', accountNumber: `${uId}-d` };
  return [wallet, debit];
}

/**
 * customer vars builder — PayBox has no parameterised customer
 * endpoint; the call routes through WK 'customer' tag and the
 * body echoes carry.uId.
 *
 * @returns Empty variables map.
 */
function customerVars(): VarsMap {
  return {};
}

/**
 * accountNumberOf — returns the synthesised display number.
 *
 * @param acct - Discriminated account ref.
 * @returns Display string for the account.
 */
function accountNumberOf(acct: IPayBoxAcct): string {
  return acct.accountNumber;
}

/**
 * balance vars builder — PayBox computes balance downstream
 * (no dedicated balance endpoint).
 *
 * @returns Empty variables map.
 */
function balanceVars(): VarsMap {
  return {};
}

/**
 * balance extractor — defaults to 0. Downstream aggregation
 * supplies the value from txn totals.
 *
 * @returns 0.
 */
function balanceExtract(): number {
  return 0;
}

/**
 * Dispatch transaction-page build by account kind. The driver
 * pairs cursor.kind with acct.kind, so the cast inside each
 * branch is safe and avoids defensive guards that produce
 * unreachable coverage branches.
 *
 * @param acct - Discriminated account ref.
 * @param cursor - Cursor matching the account kind.
 * @param ctx - Action context (passed to debit chunker).
 * @returns Variables for the next API call.
 */
function transactionsBuildVars(
  acct: IPayBoxAcct,
  cursor: IPayBoxCursor | false,
  ctx: IActionContext,
): VarsMap {
  if (acct.kind === 'wallet') {
    const walletCursor = cursor as IPayBoxWalletCursor | false;
    return walletBuildVars(walletCursor);
  }
  const debitCursor = cursor as IPayBoxDebitCursor | false;
  return debitBuildVars(debitCursor, ctx);
}

/**
 * Dispatch transaction-page extraction by account kind. The
 * driver pairs cursor.kind with acct.kind; false on the first
 * call routes to the wallet branch since wallet is the leading
 * account in the synthesised pair.
 *
 * @param body - Unwrapped response body.
 * @param cursor - Cursor used for this request.
 * @returns Page rows + nextCursor.
 */
function transactionsExtractPage(
  body: ApiBody,
  cursor: IPayBoxCursor | false,
): IPage<object, IPayBoxCursor> {
  if (cursor !== false && cursor.kind === 'debit') {
    return debitExtractPage(body, cursor);
  }
  return walletExtractPage(body, cursor);
}

/** PayBox shape declaration — consumed by buildGenericHeadlessScrape. */
const PAYBOX_SHAPE: IApiDirectScrapeShape<IPayBoxAcct, IPayBoxCursor> = {
  stepName: 'PayBoxScrape',
  accountNumberOf,
  customer: { buildVars: customerVars, extractAccounts },
  balance: { buildVars: balanceVars, extract: balanceExtract, fallbackOnFail: 0 },
  transactions: { buildVars: transactionsBuildVars, extractPage: transactionsExtractPage },
};

export default PAYBOX_SHAPE;
export { PAYBOX_SHAPE };
/** Re-export the creds type so PayBoxPipeline can wire it without a back-reference. */
export type { IPayBoxCreds } from '../PayBoxCreds.js';
