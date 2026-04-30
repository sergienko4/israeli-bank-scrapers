/**
 * Headless-scrape shape — generic per-bank contract consumed by the
 * buildGenericHeadlessScrape factory. Pure data: WK query labels,
 * variable builders, response unwrappers, pagination cursor shape.
 * Zero bank-name coupling here.
 */

import type { IPage } from '../../Strategy/Fetch/Pagination.js';
import type { IActionContext } from '../../Types/PipelineContext.js';

/** Opaque headers map (shape step may declare per-call extraHeaders). */
export type HeaderMap = Record<string, string>;

/**
 * extraHeaders may be a static map (OneZero) or a function producing
 * a map on every call (Pepper — per-request UUIDs). The driver calls
 * the function at call time, never caches its result.
 */
export type HeadlessHeadersLike = HeaderMap | ((ctx: IActionContext) => HeaderMap);
/** Opaque GraphQL variables map. */
export type VarsMap = Record<string, unknown>;
/** Generic API response body — shape's extractor narrows as needed. */
export type ApiBody = Record<string, unknown>;

/** Customer-step shape — fetches the account list once per scrape. */
export interface IHeadlessCustomerStep<TAcct> {
  readonly buildVars: (ctx: IActionContext) => VarsMap;
  readonly extractAccounts: (body: ApiBody) => readonly TAcct[];
  readonly extraHeaders?: HeadlessHeadersLike;
}

/** Balance-step shape — fetches one account's current balance. */
export interface IHeadlessBalanceStep<TAcct> {
  readonly buildVars: (acct: TAcct) => VarsMap;
  readonly extract: (body: ApiBody) => number;
  readonly extraHeaders?: HeadlessHeadersLike;
  /** Value to return on failure; undefined → propagate. */
  readonly fallbackOnFail?: number;
}

/** Transactions-step shape — paginated per-account fetch. */
export interface IHeadlessTxnsStep<TAcct, TCursor> {
  readonly buildVars: (acct: TAcct, cursor: TCursor | false, ctx: IActionContext) => VarsMap;
  readonly extractPage: (body: ApiBody, cursor: TCursor | false) => IPage<object, TCursor>;
  readonly stop?: (acc: readonly object[], ctx: IActionContext) => boolean;
  readonly extraHeaders?: HeadlessHeadersLike;
}

/** Shape a bank plugs into buildGenericHeadlessScrape. */
export interface IHeadlessScrapeShape<TAcct, TCursor> {
  readonly stepName: string;
  readonly accountNumberOf: (acct: TAcct) => string;
  readonly customer: IHeadlessCustomerStep<TAcct>;
  readonly balance: IHeadlessBalanceStep<TAcct>;
  readonly transactions: IHeadlessTxnsStep<TAcct, TCursor>;
}
