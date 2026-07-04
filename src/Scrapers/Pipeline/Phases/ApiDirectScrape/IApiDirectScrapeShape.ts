/**
 * ApiDirectScrape shape — generic per-bank contract consumed by the
 * createApiDirectScrapePhase factory. Pure data: WK query labels,
 * variable builders, response unwrappers, pagination cursor shape.
 * Zero bank-name coupling here.
 *
 * Unified-flow extensions (commit 1.F):
 *   - `urlTag` per step → REST dispatch via `apiPost` (defaults to
 *     GraphQL via `apiQuery` when absent, preserving Pepper/OneZero).
 *   - `bodyTemplate` per step → hydrated by the SAME `JsonValueTemplate`
 *     engine the login flow uses, against a scope whose `carry` is the
 *     post-login session-context. Lets banks (PayBox) declare class-y
 *     `auth: { ... }` envelopes as data, not code.
 *   - `signer` at shape root → SAME `IAesSignerConfig` type as the
 *     login flow's signer; the dispatcher applies `attachBodySignature`
 *     to each scrape-step body using the configured pointer (typically
 *     `/auth/signature`).
 *   - `extractAccounts({body, sessionContext})` → can read the
 *     post-login carry without a dedicated accounts endpoint.
 *   - `customer.skipFetch` → skip the network call entirely when
 *     accounts derive purely from session-context (PayBox uId case).
 */

import type {
  IAesSignerConfig,
  JsonValueTemplate,
} from '../../Mediator/ApiDirectCall/IApiDirectCallConfig.js';
import type { WKUrlOrLiteral } from '../../Registry/WK/UrlsWK.js';
import type { IPage } from '../../Strategy/Fetch/Pagination.js';
import type { IActionContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';

/** Opaque headers map (shape step may declare per-call extraHeaders). */
export type HeaderMap = Record<string, string>;

/**
 * REST verb for a `urlTag`-dispatched scrape step. Defaults to `POST`
 * (preserves every existing body-dispatch bank: PayBox/OneZero/Pepper).
 * GET banks — whose accounts / balance / transactions ride path + query
 * params (Discount, Max, VisaCal) — declare `method: 'GET'`; the driver
 * then calls `apiGet` with the resolved URL and sends no request body.
 */
export type ScrapeHttpMethod = 'GET' | 'POST';

/**
 * extraHeaders may be a static map (OneZero) or a function producing
 * a map on every call (Pepper — per-request UUIDs). The driver calls
 * the function at call time, never caches its result.
 */
export type ApiDirectScrapeHeadersLike = HeaderMap | ((ctx: IActionContext) => HeaderMap);
/** Opaque variables map (GraphQL variables OR REST body when urlTag is set). */
export type VarsMap = Record<string, unknown>;
/** Generic API response body — shape's extractor narrows as needed. */
export type ApiBody = Record<string, unknown>;

/**
 * REST URL tag — when set, the driver dispatches via `bus.apiPost`
 * instead of the GraphQL default. The producer variants take the
 * relevant per-call inputs (ctx / acct / cursor) so banks can pick
 * different endpoints per account kind (PayBox wallet vs debit).
 */
export type CustomerUrlTag = WKUrlOrLiteral | ((ctx: IActionContext) => WKUrlOrLiteral);
export type BalanceUrlTag<TAcct> = WKUrlOrLiteral | ((acct: TAcct) => WKUrlOrLiteral);
export type TxnsUrlTag<TAcct, TCursor> =
  WKUrlOrLiteral | ((acct: TAcct, cursor: TCursor | false, ctx: IActionContext) => WKUrlOrLiteral);

/**
 * Bundle passed to {@link IApiDirectScrapeCustomerStep.extractAccounts}.
 * Carries both the parsed response body and the post-login
 * session-context so banks whose accounts derive from login state
 * (e.g. PayBox `uId` from `/loginBySms`) can read it back without a
 * dedicated accounts endpoint.
 */
export interface IExtractAccountsArgs {
  readonly body: ApiBody;
  readonly sessionContext: Readonly<Record<string, unknown>>;
  /**
   * Response of the optional `customer.secondaryUrlTag` identity GET, or
   * `{}` when the shape declares none. Lets banks whose account identity
   * spans two calls (FIBI: `userData` accounts + a session-level
   * `accountType` lookup) fold both into each account reference. Existing
   * single-call banks ignore it.
   */
  readonly secondaryBody?: ApiBody;
}

/** Customer-step shape — fetches the account list once per scrape. */
export interface IApiDirectScrapeCustomerStep<TAcct> {
  readonly buildVars: (ctx: IActionContext) => VarsMap;
  readonly extractAccounts: (args: IExtractAccountsArgs) => readonly TAcct[];
  readonly extraHeaders?: ApiDirectScrapeHeadersLike;
  /** REST dispatch override; absent ⇒ GraphQL via apiQuery('customer'). */
  readonly urlTag?: CustomerUrlTag;
  /**
   * Optional secondary identity GET fired once, immediately after the
   * primary customer fetch. Its parsed response reaches `extractAccounts`
   * as `secondaryBody`. GET-only (carries no request body); absent ⇒
   * `secondaryBody` is `{}`. Used by FIBI banks whose transactions body
   * needs a session-level `accountType` the accounts call omits.
   */
  readonly secondaryUrlTag?: CustomerUrlTag;
  /** REST verb when `urlTag` is set; default POST. GET sends no body. */
  readonly method?: ScrapeHttpMethod;
  /**
   * Optional `JsonValueTemplate` body — when set, the dispatcher
   * hydrates this against the post-login scope (carry + creds +
   * config) and POSTs the result as the request body. Replaces
   * `buildVars` output for the actual wire payload when present.
   */
  readonly bodyTemplate?: JsonValueTemplate;
  /**
   * Skip the customer-step network call entirely — for banks whose
   * accounts are synthesised from session-context alone (PayBox
   * derives accounts from the `uId` carry slot captured during
   * login). `extractAccounts` still runs but with `body: {}`.
   */
  readonly skipFetch?: boolean;
}

/** Balance-step shape — fetches one account's current balance. */
export interface IApiDirectScrapeBalanceStep<TAcct> {
  /**
   * Build the balance-call variables (REST body when `urlTag` is set).
   * Receives `ctx` — symmetric with the customer/transactions steps — so
   * banks whose balance body carries a runtime session token (Leumi's WCF
   * `SessionHeader.SessionID`) can read it back from the mediator
   * session-context. Shapes that ignore it keep their `(acct) => …` form.
   */
  readonly buildVars: (acct: TAcct, ctx: IActionContext) => VarsMap;
  readonly extract: (body: ApiBody) => number;
  readonly extraHeaders?: ApiDirectScrapeHeadersLike;
  /** Value to return on failure; undefined → propagate. */
  readonly fallbackOnFail?: number;
  /** REST dispatch override; absent ⇒ GraphQL via apiQuery('balance'). */
  readonly urlTag?: BalanceUrlTag<TAcct>;
  /** REST verb when `urlTag` is set; default POST. GET sends no body. */
  readonly method?: ScrapeHttpMethod;
  /** Optional body template — same semantics as customer.bodyTemplate. */
  readonly bodyTemplate?: JsonValueTemplate;
  /**
   * Skip the balance-step network call entirely — for `card-cycle` banks
   * (VisaCal, Max, Amex, Isracard) that expose no account-level balance,
   * only per-cycle credit-card billing aggregates. `extract` still runs
   * but with `body: {}`, so a card-cycle shape declares `extract: () => 0`
   * for a deterministic zero balance. Mirrors
   * {@link IApiDirectScrapeCustomerStep.skipFetch}.
   */
  readonly skipFetch?: boolean;
}

/**
 * Bundle passed to {@link IApiDirectScrapeTxnsStep.extractPage}.
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
  /** REST verb when `urlTag` is set; default POST. GET sends no body. */
  readonly method?: ScrapeHttpMethod;
  /**
   * Optional body template — banks whose transactions endpoint
   * accepts a structured class-y body declare it here. When set,
   * the dispatcher hydrates against a scope augmented with the
   * step's `buildVars` output bundled under `carry.<varName>`.
   */
  readonly bodyTemplate?: JsonValueTemplate;
}

/** Balance fetch outcome: value + whether it came from `fallbackOnFail`. */
export interface IBalanceOutcome {
  readonly value: number;
  readonly degraded: boolean;
}

/**
 * Read-only summary of a completed scrape, handed to a shape's optional
 * {@link IApiDirectScrapeShape.resultGuard}. Carries only the signals a
 * fail-closed guard needs — never PII, never raw rows.
 */
export interface IApiDirectScrapeGuardSummary {
  readonly accountCount: number;
  readonly totalTxns: number;
  readonly balanceDegraded: boolean;
}

/**
 * Optional post-login PRIME navigation. Some browser banks (Amex,
 * Isracard) authorize their login-origin service via first-party cookies
 * but gate the transactions service behind a separate session the SPA only
 * establishes after navigating to its frontend route. Declaring `prime`
 * makes the driver navigate the live login page there once, before any
 * scrape fetch, so the transactions service returns 200 rather than
 * 302→login. Absent ⇒ no navigation (cookie-only + headless banks).
 */
export interface IApiDirectScrapePrime {
  /**
   * Absolute SPA route the driver navigates for the priming handshake.
   * Receives `ctx` so a bank whose route embeds a session value can build
   * it dynamically; static routes ignore the argument.
   */
  readonly navUrl: (ctx: IActionContext) => string;
}

/** Shape a bank plugs into createApiDirectScrapePhase. */
export interface IApiDirectScrapeShape<TAcct, TCursor> {
  readonly stepName: string;
  readonly accountNumberOf: (acct: TAcct) => string;
  /**
   * Optional post-login prime navigation — see {@link IApiDirectScrapePrime}.
   * Absent ⇒ no prime (cookie-only session banks + headless banks).
   */
  readonly prime?: IApiDirectScrapePrime;
  /**
   * Optional class-y body-pointer signer applied to every scrape-step
   * body before POST. Same `IAesSignerConfig` type used by the login
   * flow — only the `bodySignatureField` pointer differs (typically
   * `/auth/signature` for post-login envelopes). Absent ⇒ no body
   * signing (Pepper/OneZero pattern).
   */
  readonly signer?: IAesSignerConfig;
  /**
   * Optional crypto secrets exposed to the shape-level signer's
   * `keyRef: 'config.secrets.<name>'` lookup. Banks that body-sign
   * scrape calls (PayBox) plug the same `secrets` block their login
   * config carries — the dispatcher merges it into the synthetic
   * scope-config that backs `$ref` resolution.
   */
  readonly secrets?: Readonly<Record<string, string>>;
  readonly customer: IApiDirectScrapeCustomerStep<TAcct>;
  readonly balance: IApiDirectScrapeBalanceStep<TAcct>;
  readonly transactions: IApiDirectScrapeTxnsStep<TAcct, TCursor>;
  /**
   * Optional fail-closed guard run in the phase POST stage. Receives a
   * PII-free {@link IApiDirectScrapeGuardSummary} and returns a failure
   * Procedure to abort the run (e.g. zero transactions from a degraded
   * warm session) or `succeed(undefined)` to pass through. Absent ⇒ the
   * scrape always succeeds (Pepper / OneZero pattern).
   */
  readonly resultGuard?: (summary: IApiDirectScrapeGuardSummary) => Procedure<void>;
}
