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
import type { WKUrlGroup } from '../../Registry/WK/UrlsWK.js';
import type { IPage } from '../../Strategy/Fetch/Pagination.js';
import type { IActionContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';

/** Opaque headers map (shape step may declare per-call extraHeaders). */
export type HeaderMap = Record<string, string>;

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
export type CustomerUrlTag = WKUrlGroup | ((ctx: IActionContext) => WKUrlGroup);
export type BalanceUrlTag<TAcct> = WKUrlGroup | ((acct: TAcct) => WKUrlGroup);
export type TxnsUrlTag<TAcct, TCursor> =
  | WKUrlGroup
  | ((acct: TAcct, cursor: TCursor | false, ctx: IActionContext) => WKUrlGroup);

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
}

/** Customer-step shape — fetches the account list once per scrape. */
export interface IApiDirectScrapeCustomerStep<TAcct> {
  readonly buildVars: (ctx: IActionContext) => VarsMap;
  readonly extractAccounts: (args: IExtractAccountsArgs) => readonly TAcct[];
  readonly extraHeaders?: ApiDirectScrapeHeadersLike;
  /** REST dispatch override; absent ⇒ GraphQL via apiQuery('customer'). */
  readonly urlTag?: CustomerUrlTag;
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

/**
 * Bounded retry policy for transient (HTTP 429 / 5xx) balance-step failures.
 * Absent from a shape ⇒ single-shot dispatch (byte-identical legacy behaviour).
 */
export interface ITransientRetryPolicy {
  /** Maximum number of retry attempts after the first failure. */
  readonly maxRetries: number;
  /** Milliseconds to wait between attempts. */
  readonly backoffMs: number;
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
  /** Optional body template — same semantics as customer.bodyTemplate. */
  readonly bodyTemplate?: JsonValueTemplate;
  /**
   * Opt-in bounded retry for transient (HTTP 429 / 5xx) balance-step
   * failures. Absent ⇒ single-shot (byte-identical legacy behaviour).
   */
  readonly retryOnTransient?: ITransientRetryPolicy;
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
  /**
   * Optional body template — banks whose transactions endpoint
   * accepts a structured class-y body declare it here. When set,
   * the dispatcher hydrates against a scope augmented with the
   * step's `buildVars` output bundled under `carry.<varName>`.
   */
  readonly bodyTemplate?: JsonValueTemplate;
}

/**
 * PII-safe summary of an assembled scrape, handed to a bank's opt-in
 * {@link IApiDirectScrapeShape.resultGuard}. Carries counts plus a
 * degradation flag only — never account ids, balances, or tokens.
 */
export interface IApiDirectScrapeSummary {
  /** Number of identities resolved (accounts assembled). */
  readonly accountCount: number;
  /** Total transactions mapped across every account. */
  readonly totalTxns: number;
  /** True when any account's balance fetch fell back (degraded session). */
  readonly balanceDegraded: boolean;
}

/**
 * Opt-in fail-closed result guard. Returns a successful Procedure to
 * accept the scrape, or a typed failure to abort the phase. Banks that
 * omit it (OneZero/Pepper) are byte-identical to the legacy flow.
 */
export type ApiDirectScrapeResultGuard = (summary: IApiDirectScrapeSummary) => Procedure<void>;

/** Shape a bank plugs into createApiDirectScrapePhase. */
export interface IApiDirectScrapeShape<TAcct, TCursor> {
  readonly stepName: string;
  readonly accountNumberOf: (acct: TAcct) => string;
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
   * Optional fail-closed guard run after the scrape is assembled. The
   * generic phase invokes it ONLY when present, against a PII-safe
   * {@link IApiDirectScrapeSummary}. PayBox declares it to catch a
   * silently-degraded warm session (identity resolved, balance step
   * degraded, zero transactions) that would otherwise surface as an
   * empty success. Absent ⇒ no guard, byte-identical behaviour.
   */
  readonly resultGuard?: ApiDirectScrapeResultGuard;
}
