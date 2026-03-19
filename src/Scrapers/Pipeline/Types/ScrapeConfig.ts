/**
 * Generic scrape configuration — banks provide this, pipeline executes it.
 * Covers 80% of banks (REST API pattern: fetch accounts → fetch transactions → map).
 * Edge cases (DOM scraping, multi-endpoint) use custom ScrapeFn override.
 */

import type { ITransaction } from '../../../Transactions.js';
import type { IPipelineContext } from './PipelineContext.js';
import type { Procedure } from './Procedure.js';

/** HTTP method for API calls. */
type HttpMethod = 'GET' | 'POST';

/** Raw account identifier extracted from accounts API response. */
interface IRawAccount {
  readonly accountId: string;
  readonly balance: number;
}

/** Configuration for fetching the account/card list. */
interface IAccountsFetchConfig<TRaw> {
  /** HTTP method for accounts endpoint. */
  readonly method: HttpMethod;
  /** URL path (appended to api.base). */
  readonly path: string;
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
  ) => { path: string; postData: Record<string, string> };
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
  readonly dateFormat: string;
  /** Default currency for transactions (e.g., 'ILS'). */
  readonly defaultCurrency: string;
  /** Extra HTTP headers for API calls (e.g., auth tokens). */
  readonly extraHeaders: (ctx: IPipelineContext) => Record<string, string>;
  /** Whether to fetch accounts sequentially or in parallel. */
  readonly fetchMode: 'sequential' | 'parallel';
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
