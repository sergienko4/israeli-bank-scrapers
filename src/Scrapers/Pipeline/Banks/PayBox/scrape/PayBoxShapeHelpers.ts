/**
 * PayBox scrape shape — shared mapping helpers used by both
 * wallet and debit transaction extractors.
 *
 * mapPbStat / mapDebitStatus normalise raw status strings into
 * the canonical TransactionStatuses enum. mapAmountSign encodes
 * the credit/debit convention from /getUserHistory (amount is
 * always positive; type discriminates direction).
 *
 * Pure data mappers — no I/O, no Procedure return; callers in
 * PayBoxShapeWallet.ts / PayBoxShapeDebit.ts compose them into
 * transaction rows.
 */

import { TransactionStatuses } from '../../../../../Transactions.js';
import type { Brand } from '../../../Types/Brand.js';

/** Signed transaction amount in ILS — branded per Rule #15. */
export type PayBoxSignedAmount = Brand<number, 'PayBoxSignedAmount'>;

/** Subset of PbNotification fields consumed by mapPbNotificationToTransaction. */
export interface IPbNotification {
  readonly transactionId?: string;
  readonly _id?: string;
  readonly ts: string;
  readonly merchantName?: string;
  readonly text?: string;
  readonly amount: number;
  readonly transactionCurrency?: string;
  readonly type?: string;
  readonly stat?: string;
  readonly comment?: string;
}

/** Subset of filteredTransactions fields consumed by mapDebitToTransaction. */
export interface IDebitTxn {
  readonly id: number | string;
  readonly date: string;
  readonly amount: number;
  readonly merchantName?: string;
  readonly description?: string;
  readonly status?: string;
  readonly currency?: string;
}

/**
 * Wallet status map — covers spec.txt §6.4. Project enum only
 * exposes Completed / Pending; historical/cancelled rows map to
 * Completed (settled, terminal state).
 */
const WALLET_STATUS_MAP: Readonly<Record<string, TransactionStatuses>> = {
  completed: TransactionStatuses.Completed,
  pending: TransactionStatuses.Pending,
  rejected: TransactionStatuses.Completed,
  cancelled: TransactionStatuses.Completed,
  clearance: TransactionStatuses.Completed,
};

/** Debit status map — covers spec.txt §6.5 standard variants. */
const DEBIT_STATUS_MAP: Readonly<Record<string, TransactionStatuses>> = {
  completed: TransactionStatuses.Completed,
  pending: TransactionStatuses.Pending,
  cancelled: TransactionStatuses.Completed,
  rejected: TransactionStatuses.Completed,
};

/**
 * Map a wallet-notification status string to canonical
 * TransactionStatuses. Unknown / absent values default to
 * Completed (server-side enum is open-ended; historical rows are
 * terminal).
 *
 * @param raw - Status string on a PbNotification.
 * @returns Canonical TransactionStatuses value.
 */
export function mapPbStat(raw?: string): TransactionStatuses {
  if (!raw) return TransactionStatuses.Completed;
  return WALLET_STATUS_MAP[raw] ?? TransactionStatuses.Completed;
}

/**
 * Map a debit-transaction status string to canonical
 * TransactionStatuses. Unknown / absent values default to
 * Completed.
 *
 * @param raw - Status string on a filteredTransactions row.
 * @returns Canonical TransactionStatuses value.
 */
export function mapDebitStatus(raw?: string): TransactionStatuses {
  if (!raw) return TransactionStatuses.Completed;
  return DEBIT_STATUS_MAP[raw] ?? TransactionStatuses.Completed;
}

/**
 * Apply PayBox's amount-sign convention: credit-type rows are
 * incoming (positive); everything else is outgoing (negative).
 *
 * @param amount - Absolute amount from the row.
 * @param type - Transaction type discriminator.
 * @returns Signed amount per the convention.
 */
export function mapAmountSign(amount: number, type?: string): PayBoxSignedAmount {
  if (type === 'credit') return Math.abs(amount) as PayBoxSignedAmount;
  return -Math.abs(amount) as PayBoxSignedAmount;
}
