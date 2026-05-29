import type { Procedure } from '../Procedure.js';

/** Auto-discovered API fetch context — injected by DASHBOARD phase. */
interface IApiFetchContext {
  /** Fetch POST with auto-injected auth + headers. Bank provides URL + body only. */
  fetchPost<T>(url: string, body: Record<string, string | object>): Promise<Procedure<T>>;
  /** Fetch GET with auto-injected auth + headers. Bank provides URL only. */
  fetchGet<T>(url: string): Promise<Procedure<T>>;
  /** Discovered transactions endpoint URL (or false). */
  readonly transactionsUrl: string | false;
  /** Discovered balance endpoint URL (or false). */
  readonly balanceUrl: string | false;
  /** Discovered pending endpoint URL (or false). */
  readonly pendingUrl: string | false;
  /** Config-fallback transaction URL — used when discovery finds no txn endpoint. */
  readonly configTransactionsUrl?: string | false;
}

export type { IApiFetchContext };
