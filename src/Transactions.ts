export interface ITransactionsAccount {
  accountNumber: string;
  balance?: number;
  txns: ITransaction[];
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
