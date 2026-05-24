/**
 * ApiDirectScrape shape — generic per-bank contract consumed by the
 * createApiDirectScrapePhase factory. Pure data: WK query labels,
 * variable builders, response unwrappers, pagination cursor shape.
 * Zero bank-name coupling here.
 */

import type { WKUrlGroup } from '../../Registry/WK/UrlsWK.js';
import type { IPage } from '../../Strategy/Fetch/Pagination.js';
import type { IActionContext } from '../../Types/PipelineContext.js';

/** Opaque headers map (shape step may declare per-call extraHeaders). */
export type HeaderMap = Record<string, string>;

/**
 * extraHeaders may be a static map (OneZero) or a function producing
 * a map on every call (Pepper — per-request UUIDs). The driver calls
 * the function at call time, never caches its result.
 */
export type ApiDirectScrapeHeadersLike = HeaderMap | ((ctx: IActionContext) => HeaderMap);
/** Opaque GraphQL variables map (also reused as REST body when urlTag is set). */
export type VarsMap = Record<string, unknown>;
/** Generic API response body — shape's extractor narrows as needed. */
export type ApiBody = Record<string, unknown>;

/**
 * REST URL tag — when present on a scrape step, the driver dispatches
 * via `bus.apiPost(urlTag, vars, opts)` instead of the GraphQL default
 * (`bus.apiQuery(<step-name>, vars, opts)`). Banks whose customer /
 * balance / transactions endpoints are REST (e.g. PayBox) declare
 * `urlTag` on each step they want to route through `apiPost`.
 */
export type CustomerUrlTag = WKUrlGroup | ((ctx: IActionContext) => WKUrlGroup);
export type BalanceUrlTag<TAcct> = WKUrlGroup | ((acct: TAcct) => WKUrlGroup);
export type TxnsUrlTag<TAcct, TCursor> =
  | WKUrlGroup
  | ((acct: TAcct, cursor: TCursor | false, ctx: IActionContext) => WKUrlGroup);

/** Customer-step shape — fetches the account list once per scrape. */
export interface IApiDirectScrapeCustomerStep<TAcct> {
  readonly buildVars: (ctx: IActionContext) => VarsMap;
  readonly extractAccounts: (body: ApiBody) => readonly TAcct[];
  readonly extraHeaders?: ApiDirectScrapeHeadersLike;
  /** REST dispatch override; absent ⇒ GraphQL via apiQuery('customer'). */
  readonly urlTag?: CustomerUrlTag;
}

/** Balance-step shape — fetches one account's current balance. */
export interface IApiDirectScrapeBalanceStep<TAcct> {
  readonly buildVars: (acct: TAcct) => VarsMap;
  readonly extract: (body: ApiBody) => number;
  readonly extraHeaders?: ApiDirectScrapeHeadersLike;
  /** Value to return on failure; undefined → propagate. */
  readonly fallbackOnFail?: number;
  /** REST dispatch override; absent ⇒ GraphQL via apiQuery('balance'). */
  readonly urlTag?: BalanceUrlTag<TAcct>;
}

/**
 * Bundle of arguments passed to {@link IApiDirectScrapeTxnsStep.extractPage}.
 * Carries the per-account context so dispatching shapes (e.g. PayBox)
 * can pick the right branch on the first call where `cursor === false`.
 */
export interface IExtractPageArgs<TAcct, TCursor> {
  readonly body: ApiBody;
  readonly cursor: TCursor | false;
  readonly acct: TAcct;
  readonly ctx: IActionContext;
}

/** Transactions-step shape — paginated per-account fetch. */
export interface IApiDirectScrapeTxnsStep<TAcct, TCursor> {
  readonly buildVars: (acct: TAcct, cursor: TCursor | false, ctx: IActionContext) => VarsMap;
  readonly extractPage: (args: IExtractPageArgs<TAcct, TCursor>) => IPage<object, TCursor>;
  readonly stop?: (acc: readonly object[], ctx: IActionContext) => boolean;
  readonly extraHeaders?: ApiDirectScrapeHeadersLike;
  /** REST dispatch override; absent ⇒ GraphQL via apiQuery('transactions'). */
  readonly urlTag?: TxnsUrlTag<TAcct, TCursor>;
}

/** Shape a bank plugs into createApiDirectScrapePhase. */
export interface IApiDirectScrapeShape<TAcct, TCursor> {
  readonly stepName: string;
  readonly accountNumberOf: (acct: TAcct) => string;
  readonly customer: IApiDirectScrapeCustomerStep<TAcct>;
  readonly balance: IApiDirectScrapeBalanceStep<TAcct>;
  readonly transactions: IApiDirectScrapeTxnsStep<TAcct, TCursor>;
}
