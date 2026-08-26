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
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { IDeclaredRowSpec } from '../../Mediator/Scrape/CoverageAudit/DeclaredRows.js';
import type { WKUrlOrLiteral } from '../../Registry/WK/UrlsWK.js';
import type { IPage } from '../../Strategy/Fetch/Pagination.js';
import type { IActionContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import type { WindowNarrowing } from '../../Types/WindowNarrowing.js';

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
  /**
   * Read the balance for one account.
   *
   * Receives the account alongside the response — symmetric with
   * `buildVars` and {@link IExtractPageArgs} — so a shape whose balance
   * already rode an earlier step's payload can answer without a second
   * call. Max carries its per-card cycle debit this way and pairs it with
   * `skipFetch`. Shapes that only need the response keep their
   * `(body) => …` form.
   */
  readonly extract: (body: ApiBody, acct: TAcct) => number;
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
   * Skip the balance-step network call entirely.
   *
   * Two kinds of shape use it. Most `card-cycle` issuers (VisaCal, Amex,
   * Isracard) publish no figure attributable to a single card, so they
   * declare `extract: () => 0` for a deterministic zero. Max instead
   * carries its per-card cycle debit on the account itself, so it skips
   * the fetch because the value is already in hand — not because none
   * exists. Mirrors {@link IApiDirectScrapeCustomerStep.skipFetch}.
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

/**
 * How a bank's transactions request expresses the window's upper bound.
 * Re-exported from `Types/WindowNarrowing.ts`, where it is shared with the
 * Mediator that acts on the declaration.
 */
export type { WindowNarrowing } from '../../Types/WindowNarrowing.js';

/** Transactions-step shape — paginated per-account fetch. */
export interface IApiDirectScrapeTxnsStep<TAcct, TCursor> {
  readonly buildVars: (acct: TAcct, cursor: TCursor | false, ctx: IActionContext) => VarsMap;
  readonly extractPage: (args: IExtractPageArgs<TAcct, TCursor>) => IPage<object, TCursor>;
  /**
   * Whether a coverage gap on this bank can be backfilled by re-asking for an
   * older slice. Required, so adding a bank without deciding is a compile
   * error rather than a silent `undefined` that skips the backfill.
   */
  readonly windowNarrowing: WindowNarrowing;
  /**
   * Whether consecutive pages of this step's walk can re-serve the same rows.
   *
   * A shape whose cursor re-asks a boundary **inclusively** — the only way to
   * recover rows a row-count cap withheld part-way through a day — receives
   * rows it already holds. Declaring this makes the paginator drop them by raw
   * row identity instead of concatenating. Absent means pages are disjoint and
   * concatenation is safe, which is true of every date-chunked walk.
   */
  readonly pagesMayOverlap?: boolean;
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
  /**
   * Canonical field names that identify one row, enabling duplicate
   * collapse for this bank. Absent ⇒ no dedup, which is the default.
   *
   * Opt-in because collapsing is destructive and no obvious key is
   * safe: measured across captured traffic, `identifier` repeats
   * across distinct rows on three of nine banks, and a
   * date + amount + description composite collides on two more. A
   * declared key therefore only nominates candidates — a row is
   * removed only when its key *and* its full content match one
   * already kept, and a key that matches while content differs is
   * reported as mis-declared rather than acted on. See
   * `Mediator/Scrape/TxnDedup.ts` for the measurements a bank needs
   * to reproduce before declaring one.
   */
  readonly dedupKeyFields?: readonly string[];
  /**
   * Containers whose response states its own row count beside the rows,
   * enabling authoritative loss detection for this bank. Absent ⇒ only the
   * heuristic coverage audit applies, which is the default.
   *
   * A count is an oracle only when it sits beside the rows it counts.
   * Response-level totals were measured and rejected: Isracard/Amex's
   * `transactionsCount` summarises a whole billing cycle and never once
   * matched the extracted row count, so checking against it would warn on
   * every healthy run. See `Mediator/Scrape/CoverageAudit/DeclaredRows.ts`.
   */
  readonly declaredRowSpecs?: readonly IDeclaredRowSpec[];
  /**
   * Whether a hunted row belongs to this account.
   *
   * Declared only by banks whose response carries **every** account merged, so
   * the per-account extractor legitimately returns a subset. Without it the
   * coverage audit hunts the whole body and reports every *other* account's
   * rows as loss — a WARN on every page of every run, forever.
   *
   * Absent means the response is already scoped to one account, which is the
   * case for every bank but Max. Declared rather than inferred: whether a
   * response is merged is part of a bank's hard model, not something the
   * generic audit should guess at.
   */
  readonly auditOwnsRow?: (row: object, acct: TAcct) => boolean;
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

/**
 * Session-context patch a bootstrap step deposits. The driver MERGES it
 * into the existing session-context snapshot (never replaces), so the
 * post-login identity fields (`uId`, `token`, `deviceId16Hex`) survive.
 */
export type SessionContextPatch = Readonly<Record<string, unknown>>;

/** Bundle handed to a bootstrap step's patch extractor. */
export interface IBootstrapExtractArgs {
  readonly body: ApiBody;
  readonly ctx: IActionContext;
}

/**
 * Optional pre-scrape BOOTSTRAP step. Dispatched exactly once, after
 * `prime` and before the customer step, through the same signed-POST
 * machinery the scrape steps use (shape-level `signer` + `secrets`). Its
 * parsed response body is handed to `extractPatch`, whose returned patch
 * is merged into the mediator session-context so later steps — and the
 * transport-level request signer — can read the deposited values.
 *
 * <p>PayBox uses this to fetch + decrypt its per-session HMAC signing key
 * (`getKey`) before the authenticated reads that now require signed
 * request headers. Absent ⇒ no bootstrap (every other bank).
 */
export interface IApiDirectScrapeBootstrapStep {
  readonly urlTag: WKUrlOrLiteral;
  readonly method?: ScrapeHttpMethod;
  readonly buildVars: (ctx: IActionContext) => VarsMap;
  readonly bodyTemplate?: JsonValueTemplate;
  readonly extraHeaders?: ApiDirectScrapeHeadersLike;
  readonly extractPatch: (args: IBootstrapExtractArgs) => Procedure<SessionContextPatch>;
}

/** Shape a bank plugs into createApiDirectScrapePhase. */
export interface IApiDirectScrapeShape<TAcct, TCursor> {
  readonly stepName: string;
  readonly accountNumberOf: (acct: TAcct) => string;
  /**
   * True for a credit-card issuer, false or absent for a bank account.
   *
   * Card issuers report a charge as a POSITIVE number — "you owe 122.17" —
   * while a bank reports the same movement as negative. The mapper flips the
   * sign for the former and leaves the latter alone, so it has to know which
   * it is looking at.
   *
   * This is a fact about the INSTITUTION, which is why it is declared here
   * instead of sniffed from the payload. The mapper used to infer it from the
   * presence of a `dealSumType` field, which only some issuers send: every
   * other card issuer was silently treated as a bank, and its charges came out
   * positive — recorded as money received rather than spent. Nothing failed
   * and no row was dropped; the amounts were simply inverted.
   *
   * Optional so every existing shape keeps its current behaviour: absent means
   * "not a card issuer", which is what a bank shape wants.
   */
  readonly isCardIssuer?: boolean;
  /**
   * Optional post-login prime navigation — see {@link IApiDirectScrapePrime}.
   * Absent ⇒ no prime (cookie-only session banks + headless banks).
   */
  readonly prime?: IApiDirectScrapePrime;
  /**
   * Optional pre-scrape bootstrap step — see
   * {@link IApiDirectScrapeBootstrapStep}. Runs once after `prime` and
   * before the customer step; its patch is merged into session-context.
   * Absent ⇒ no bootstrap (every bank except PayBox getKey).
   */
  readonly bootstrap?: IApiDirectScrapeBootstrapStep;
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
   * phase default guard applies, which fails a run that resolved zero
   * accounts (a universally invalid post-login outcome).
   */
  readonly resultGuard?: (summary: IApiDirectScrapeGuardSummary) => Procedure<void>;
}
