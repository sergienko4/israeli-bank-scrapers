/**
 * PayBox wallet-row → canonical {@link ITransaction} mapper. Split from
 * PayBoxShapeTxns.ts to keep both files under the 150-LOC ceiling. The
 * autoMapTransaction downstream drops rows whose field-names do not
 * match the canonical aliases; this mapper translates PayBox's
 * (`amt`, `ts` ISO, `merchantName`, `state`, …) into the canonical
 * shape so every row survives.
 */

import type { ITransaction } from '../../../../../Transactions.js';
import { TransactionStatuses, TransactionTypes } from '../../../../../Transactions.js';

/** Raw wallet row returned by /getUserHistory `content.nc[i]`. */
export interface IWalletTxnRaw {
  readonly transactionId?: string;
  readonly _id?: string;
  readonly ts?: string;
  readonly type?: string;
  readonly state?: string;
  readonly amt?: number;
  readonly transactionCurrency?: string;
  readonly merchantName?: string;
  readonly text?: string;
  readonly comment?: string;
  readonly userComment?: string;
}

/** Wallet rows never split into installments — every row is `Normal`. */
const WALLET_TXN_TYPE = TransactionTypes.Normal;

/**
 * Resolve the sign-adjusted amount per PayBox's type convention: rows
 * whose `type` starts with `outgoing` are debits (`-amt`); everything
 * else is treated as credit (`+amt`).
 * @param raw - Raw wallet row.
 * @returns Sign-adjusted amount.
 */
function signedAmount(raw: IWalletTxnRaw): number {
  const amt = typeof raw.amt === 'number' ? raw.amt : 0;
  const type = raw.type ?? '';
  if (type.startsWith('outgoing')) return -amt;
  return amt;
}

/**
 * Map PayBox's `state` field to the canonical {@link TransactionStatuses}.
 * Only `Completed` / `Pending` exist canonically — non-done rows
 * (`pending` / `rejected` / `cancelled`) fold into `Pending`.
 * @param raw - Raw wallet row.
 * @returns Canonical status.
 */
export function statusOf(raw: IWalletTxnRaw): TransactionStatuses {
  const state = raw.state ?? '';
  if (state === 'done') return TransactionStatuses.Completed;
  return TransactionStatuses.Pending;
}

/**
 * Decode PayBox's `ts` (ISO-8601 string) into a canonical ISO date.
 * Invalid / missing values fall back to epoch so a single malformed
 * row never bubbles up as a `RangeError` from `toISOString`.
 * @param raw - Raw wallet row.
 * @returns ISO date string.
 */
function dateOf(raw: IWalletTxnRaw): string {
  const parsed = new Date(raw.ts ?? 0);
  const ms = parsed.getTime();
  const stamp = Number.isFinite(ms) ? parsed : new Date(0);
  return stamp.toISOString();
}

/** Bundle of consumer-visible fields decoded from PayBox's row shape. */
interface IDisplay {
  readonly description: string;
  readonly memo: string;
}

/**
 * Resolve canonical `description` / `memo` with PayBox's fallback chain.
 * @param raw - Raw wallet row.
 * @returns Display bundle (description + memo).
 */
function displayOf(raw: IWalletTxnRaw): IDisplay {
  return {
    description: raw.merchantName ?? raw.text ?? '',
    memo: raw.comment ?? raw.userComment ?? '',
  };
}

/** Bundle of money-related fields decoded from PayBox's row shape. */
interface IMoney {
  readonly chargedAmount: number;
  readonly originalAmount: number;
  readonly originalCurrency: string;
}

/**
 * Resolve canonical money fields. Sign convention is encoded by
 * `signedAmount`; currency defaults to ILS when absent.
 * @param raw - Raw wallet row.
 * @returns Money bundle.
 */
function moneyOf(raw: IWalletTxnRaw): IMoney {
  const amount = signedAmount(raw);
  return {
    chargedAmount: amount,
    originalAmount: amount,
    originalCurrency: raw.transactionCurrency ?? 'ILS',
  };
}

/**
 * Map one raw wallet row to the canonical ITransaction shape so
 * `autoMapTransaction` accepts it. PayBox's `ts` is an ISO-8601 string,
 * `amt` is the amount (sign derived from `type` prefix), and
 * `merchantName` carries the human-readable description.
 * @param raw - Raw row from `content.nc[i]`.
 * @returns Canonical transaction.
 */
export function mapWalletTxn(raw: IWalletTxnRaw): ITransaction {
  const date = dateOf(raw);
  return {
    identifier: raw.transactionId ?? raw._id ?? '',
    date,
    processedDate: date,
    ...displayOf(raw),
    ...moneyOf(raw),
    status: statusOf(raw),
    type: WALLET_TXN_TYPE,
  };
}
