import type { IWindowCoverage } from './WindowCoverage.js';

export interface ITransactionsAccount {
  accountNumber: string;
  balance?: number;
  txns: ITransaction[];
  /**
   * What this account can honestly claim about the window that was requested.
   *
   * <p>`txns` alone cannot answer it. A short list and a complete one are the
   * same shape, so a caller who receives thirty days after asking for ninety
   * has no way to tell a quiet account from a truncated one. This field is
   * that answer, per account, because the scrape's own window audit is
   * per-account.
   *
   * <p>Read {@link IWindowCoverage.status} first: `covered` means the start
   * was reached and every loss signal the scrape can observe was clean;
   * `lowerBoundReached` means the start was reached but something reported
   * loss along the way (see `caveats`); `unproven` means the start was never
   * reached (see `reason`).
   *
   * <p>Even `covered` does not prove that no row in the *middle* of the window
   * was dropped silently — that needs provider-side totals no Israeli bank
   * sends. See `src/WindowCoverage.ts` for the full contract.
   *
   * <p>Optional because only the Pipeline's API-direct scrapers run the audit.
   * Absent means "not assessed", never "assessed and fine".
   */
  windowCoverage?: IWindowCoverage;
}

export enum TransactionTypes {
  Normal = 'normal',
  Installments = 'installments',
}

export enum TransactionStatuses {
  Completed = 'completed',
  Pending = 'pending',
}

export interface ITransactionInstallments {
  /**
   * the current installment number
   */
  number: number;

  /**
   * the total number of installments
   */
  total: number;
}

export interface ITransaction {
  type: TransactionTypes;
  /**
   * sometimes called Asmachta
   */
  identifier?: string | number;
  /**
   * ISO-8601 date/date-time string.
   *
   * <p><b>Pipeline scrapers</b> emit a UTC instant. Most Israeli providers
   * state a *day* with no time and no offset; the Pipeline resolves such a
   * value to midnight of that day in the bank's calendar (`Asia/Jerusalem`), so
   * the instant is stable no matter what zone the scraper runs in.
   *
   * <p>That means the provider's stated day is **not** the UTC date prefix —
   * `2026-06-28T21:00:00.000Z` is the 29th in Israel. Read the day in the bank
   * calendar to recover it:
   *
   * ```ts
   * moment(txn.date).tz('Asia/Jerusalem').format('YYYY-MM-DD'); // '2026-06-29'
   * ```
   *
   * <p><b>Legacy (deprecated) scrapers</b> are frozen and are not covered by
   * that convention — some emit a bare `YYYY-MM-DD` day instead of an instant.
   * Parse defensively if you consume both families.
   *
   * @see docs/architecture/bank-calendar.md
   */
  date: string;
  /**
   * ISO-8601 date/date-time string. Same calendar convention, and the same
   * Legacy caveat, as {@link ITransaction.date}.
   */
  processedDate: string;
  originalAmount: number;
  originalCurrency: string;
  chargedAmount: number;
  chargedCurrency?: string;
  description: string;
  memo?: string;
  status: TransactionStatuses;
  installments?: ITransactionInstallments;
  category?: string;
  rawTransaction?: unknown;
}
