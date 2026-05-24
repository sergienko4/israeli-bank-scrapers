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
  IExtractPageArgs,
  VarsMap,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { WKUrlGroup } from '../../../Registry/WK/UrlsWK.js';
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

/** Debit account display-number suffix — appended to uId per spec.txt §6.6. */
const DEBIT_ACCOUNT_SUFFIX = '-d';

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
  const debit: IPayBoxDebitAcct = {
    kind: 'debit',
    accountNumber: `${uId}${DEBIT_ACCOUNT_SUFFIX}`,
  };
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
 * Wallet branch of transactionsBuildVars — casts the union cursor
 * to the wallet-shape variant the driver guarantees here.
 * @param cursor - Cursor matching the wallet account.
 * @returns Variables for the wallet API call.
 */
function transactionsWalletVars(cursor: IPayBoxCursor | false): VarsMap {
  return walletBuildVars(cursor as IPayBoxWalletCursor | false);
}

/**
 * Debit branch of transactionsBuildVars — casts the union cursor
 * to the debit-shape variant the driver guarantees here.
 * @param cursor - Cursor matching the debit account.
 * @param ctx - Action context (carries the user-supplied startDate).
 * @returns Variables for the debit API call.
 */
function transactionsDebitVars(cursor: IPayBoxCursor | false, ctx: IActionContext): VarsMap {
  return debitBuildVars(cursor as IPayBoxDebitCursor | false, ctx);
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
  if (acct.kind === 'wallet') return transactionsWalletVars(cursor);
  return transactionsDebitVars(cursor, ctx);
}

/**
 * Dispatch transaction-page extraction by account kind. Routing uses
 * `acct.kind` directly (cursor is `false` on first call so cannot
 * carry the discriminator) — wallet and debit accounts each get
 * their own pagination loop.
 *
 * @param args - Bundle carrying body, cursor, acct, ctx.
 * @returns Page rows + nextCursor.
 */
function transactionsExtractPage(
  args: IExtractPageArgs<IPayBoxAcct, IPayBoxCursor>,
): IPage<object, IPayBoxCursor> {
  if (args.acct.kind === 'debit') {
    return debitExtractPage(args.body, args.cursor as IPayBoxDebitCursor | false, args.ctx);
  }
  return walletExtractPage(args.body, args.cursor as IPayBoxWalletCursor | false);
}

/**
 * Pick the REST URL for the transactions step based on account kind:
 * wallet rows come from /getUserHistory; debit rows from
 * /virtualCardTranRequest. Both are POST endpoints routed through the
 * mediator's `apiPost` via the shape's urlTag dispatch.
 * @param acct - Discriminated account ref.
 * @returns WK URL group for the matching endpoint.
 */
function transactionsUrlTag(acct: IPayBoxAcct): WKUrlGroup {
  if (acct.kind === 'wallet') return 'data.getUserHistory';
  return 'data.virtualCardTranRequest';
}

/** PayBox shape declaration — consumed by buildGenericHeadlessScrape. */
const PAYBOX_SHAPE: IApiDirectScrapeShape<IPayBoxAcct, IPayBoxCursor> = {
  stepName: 'PayBoxScrape',
  accountNumberOf,
  customer: {
    buildVars: customerVars,
    extractAccounts,
    urlTag: 'data.getUserHistory',
  },
  balance: {
    buildVars: balanceVars,
    extract: balanceExtract,
    fallbackOnFail: 0,
    urlTag: 'data.sync',
  },
  transactions: {
    buildVars: transactionsBuildVars,
    extractPage: transactionsExtractPage,
    urlTag: transactionsUrlTag,
  },
};

export default PAYBOX_SHAPE;
export { PAYBOX_SHAPE };
/** Re-export the creds type so PayBoxPipeline can wire it without a back-reference. */
export type { IPayBoxCreds } from '../PayBoxCreds.js';
