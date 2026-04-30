/**
 * Generic scrape configuration — banks provide this, pipeline executes it.
 * Covers 80% of banks (REST API pattern: fetch accounts → fetch transactions → map).
 * Edge cases (DOM scraping, multi-endpoint) use custom ScrapeFn override.
 */

import type { ITransaction } from '../../../Transactions.js';
import type { IPipelineContext } from './PipelineContext.js';
import type { Procedure } from './Procedure.js';

/** Raw account identifier string from the accounts API. */
type RawAccountId = string;
/** Raw balance value from the accounts API. */
type RawBalance = number;
/** URL path segment for an API endpoint (no base URL). */
type ApiPath = string;
/** Date format string for the bank's API (e.g. 'YYYYMMDD'). */
type DateFormatStr = string;
/** ISO currency code string (e.g. 'ILS', 'USD'). */
type CurrencyStr = string;

/** HTTP method for API calls. */
type HttpMethod = 'GET' | 'POST';

/** Raw account identifier extracted from accounts API response. */
interface IRawAccount {
  readonly accountId: RawAccountId;
  readonly balance: RawBalance;
}

/** Configuration for fetching the account/card list. */
interface IAccountsFetchConfig<TRaw> {
  /** HTTP method for accounts endpoint. */
  readonly method: HttpMethod;
  /** URL path (appended to api.base). */
  readonly path: ApiPath;
  /** POST body data (for POST method). Empty for GET. */
  readonly postData: Record<string, string>;
  /** Extract account IDs + balances from raw API response. */
  readonly mapper: (raw: TRaw) => readonly IRawAccount[];
}

/** Configuration for fetching transactions per account. */
interface ITransactionsFetchConfig<TRaw> {
  /** HTTP method for transactions endpoint. */
  readonly method: HttpMethod;
  /**
   * Build the URL/params for one account's transactions.
   * @param accountId - The account/card ID.
   * @param startDate - Formatted start date string.
   * @returns URL path + optional POST data.
   */
  readonly buildRequest: (
    accountId: string,
    startDate: string,
  ) => { path: ApiPath; postData: Record<string, string> };
  /** Extract ITransaction[] from raw API response. */
  readonly mapper: (raw: TRaw) => readonly ITransaction[];
}

/** Pagination strategy for transaction fetching. */
type PaginationKind =
  | { readonly kind: 'none' }
  | { readonly kind: 'monthly'; readonly defaultMonthsBack: number };

/**
 * Generic scrape config — banks provide this to define their scrape flow.
 * The pipeline handles fetch, error handling, account iteration, and context assembly.
 * @template TAccountsRaw - Shape of the accounts API response.
 * @template TTxnRaw - Shape of the transactions API response.
 */
interface IScrapeConfig<TAccountsRaw, TTxnRaw> {
  /** How to fetch the account/card list. */
  readonly accounts: IAccountsFetchConfig<TAccountsRaw>;
  /** How to fetch transactions per account. */
  readonly transactions: ITransactionsFetchConfig<TTxnRaw>;
  /** Pagination strategy. */
  readonly pagination: PaginationKind;
  /** Date format string for the bank's API (e.g., 'YYYYMMDD'). */
  readonly dateFormat: DateFormatStr;
  /** Default currency for transactions (e.g., 'ILS'). */
  readonly defaultCurrency: CurrencyStr;
  /** Extra HTTP headers for API calls (e.g., auth tokens). */
  readonly extraHeaders: (ctx: IPipelineContext) => Record<string, string>;
  /** Optional: extract balance from the txn response (accounts endpoint may not have it). */
  readonly balanceExtractor?: (raw: TTxnRaw) => number;
}

/**
 * Full bank pipeline configuration — everything the pipeline needs.
 * Banks provide ONLY this. No classes, no inheritance.
 * @template TAccountsRaw - Shape of the accounts API response.
 * @template TTxnRaw - Shape of the transactions API response.
 */
interface IBankPipelineConfig<TAccountsRaw, TTxnRaw> {
  /** Scrape configuration — accounts + transactions + mappers. */
  readonly scrape: IScrapeConfig<TAccountsRaw, TTxnRaw>;
}

/**
 * Non-generic base for IScrapeConfig — used by PipelineBuilder storage.
 * Erases TAccountsRaw/TTxnRaw so the builder doesn't need generics.
 */
type IScrapeConfigBase = IScrapeConfig<object, object>;

/**
 * Custom scrape function — for banks that don't fit the generic pattern.
 * Receives pipeline context, returns updated context with accounts.
 */
type CustomScrapeFn = (ctx: IPipelineContext) => Promise<Procedure<IPipelineContext>>;

export type {
  CustomScrapeFn,
  HttpMethod,
  IAccountsFetchConfig,
  IBankPipelineConfig,
  IRawAccount,
  IScrapeConfig,
  IScrapeConfigBase,
  ITransactionsFetchConfig,
  PaginationKind,
};
