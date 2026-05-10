/**
 * Pipeline context — immutable, accumulated across phases.
 * Each phase returns a NEW context with spread.
 * All config injected via DI — no direct imports of SCRAPER_CONFIGURATION.
 */

import type { BrowserContext, Frame, Page } from 'playwright-core';

import type { CompanyTypes } from '../../../Definitions.js';
import type { ITransaction, ITransactionsAccount } from '../../../Transactions.js';
import type { ScraperCredentials, ScraperOptions } from '../../Base/Interface.js';
import type { IApiMediator } from '../Mediator/Api/ApiMediator.js';
import type { IActionMediator, IElementMediator } from '../Mediator/Elements/ElementMediator.js';
import type { IFormAnchor } from '../Mediator/Form/FormAnchor.js';
import type { IDiscoveredEndpoint } from '../Mediator/Network/NetworkDiscoveryTypes.js';
import type { IPipelineBankConfig } from '../Registry/Config/PipelineBankConfig.js';
import type { IFetchStrategy } from '../Strategy/Fetch/FetchStrategy.js';
import type { ScraperLogger } from './Debug.js';
import type { Option } from './Option.js';
import type { Procedure } from './Procedure.js';

/** Cleanup handler return type — side-effect only, no payload. */
type CleanupResult = Procedure<void>;

/** Browser lifecycle context — absent for API-only scrapers. */
interface IBrowserState {
  readonly page: Page;
  readonly context: BrowserContext;
  readonly cleanups: readonly (() => Promise<CleanupResult>)[];
}

/** Login phase result context. */
interface ILoginState {
  readonly activeFrame: Page | Frame;
  readonly persistentOtpToken: Option<string>;
}

/** Dashboard phase result context. */
interface IDashboardState {
  readonly isReady: boolean;
  readonly pageUrl: string;
  readonly trafficPrimed: boolean;
}

/** Scrape phase result context. */
interface IScrapeState {
  readonly accounts: readonly ITransactionsAccount[];
}

/** API strategy kind — DIRECT (SPA traffic). After .ashx removal there
 *  is one strategy; the enum is retained as a single-value frozen
 *  constant so existing callers (`apiStrategy: API_STRATEGY.DIRECT`)
 *  keep compiling without surprises. */
const API_STRATEGY = {
  DIRECT: 'DIRECT',
} as const;

/** Union type for API strategy. */
type ApiStrategyKind = (typeof API_STRATEGY)[keyof typeof API_STRATEGY];

/** Diagnostics state — tracks timing and breadcrumbs. */
interface IDiagnosticsState {
  readonly loginUrl: string;
  readonly finalUrl: Option<string>;
  readonly loginStartMs: number;
  readonly fetchStartMs: Option<number>;
  readonly lastAction: string;
  readonly pageTitle: Option<string>;
  readonly warnings: readonly string[];
  /** Target URL extracted in DASHBOARD.PRE for navigation. */
  readonly dashboardTargetUrl?: string;
  /** Pre-resolved single click target from DASHBOARD.PRE (IDENTITY-based
   *  race winner of `resolveVisible` against `WK_DASHBOARD.TRANSACTIONS`).
   *  ACTION clicks this FIRST (HEAD behaviour — proven winner). Only when
   *  this fails to trigger a txn signal does ACTION fall back to iterating
   *  `dashboardFallbackSelector`'s `.nth(0..count-1)`. */
  readonly dashboardTarget?: IResolvedTarget;
  /** Generic-selector fallback string (e.g. `[aria-label="..."]` or
   *  `text=...`) used by ACTION ONLY when the identity click yields no
   *  success signal — covers Beinleumi pm.mataf vs pm.q077 (same
   *  aria-label, different elements). */
  readonly dashboardFallbackSelector?: string;
  /** Number of DOM matches for `dashboardFallbackSelector` in the winning
   *  frame. ≥1 when `dashboardTarget` set; 0 otherwise. ACTION iterates
   *  `.nth(0..count-1)` after identity click failed. */
  readonly dashboardCandidateCount?: number;
  /** Pre-resolved menu toggle target for SEQUENTIAL dashboard nav. */
  readonly dashboardMenuTarget?: IResolvedTarget;
  /** Whether txn traffic already exists from login redirect — skip click if true. */
  readonly dashboardTrafficExists?: boolean;
  /** Auth token discovered from iframe sessionStorage in DASHBOARD.FINAL. */
  readonly discoveredAuth?: string | false;
  /** How the login form was submitted — used by POST to decide validation. */
  readonly submitMethod?: 'enter' | 'click' | 'both';
  /** API strategy discovered in LOGIN.FINAL — single value (DIRECT) post .ashx removal. */
  readonly apiStrategy?: ApiStrategyKind;
}

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

/**
 * Discovery status returned by PreLogin.PRE for each reveal candidate.
 *   READY    — element found and visible → ACTION fires a normal click.
 *   OBSCURED — element in DOM but not visible (e.g. aria-hidden by UserWay) → ACTION uses force:true.
 *   NOT_FOUND — element absent from DOM → ACTION skips.
 */
export type RevealStatus = 'READY' | 'OBSCURED' | 'NOT_FOUND';

/** PRE discovery results stored in context — ACTION reads these instead of re-discovering. */
/** Reveal action determined by PRE for ACTION to execute. */
type RevealAction = 'CLICK' | 'NAVIGATE' | 'NONE';

export interface IPreLoginDiscovery {
  /** Status of the Business/Private split selector. */
  readonly privateCustomers: RevealStatus;
  /** Status of the credential mode toggle (password vs SMS/OTP). */
  readonly credentialArea: RevealStatus;
  /** What ACTION must do: click, navigate, or nothing. */
  readonly revealAction: RevealAction;
  /** Pre-resolved target for ACTION to click/navigate (contextId + selector). */
  readonly revealTarget?: IResolvedTarget;
}

// ── Phase-Specific Discovery Types (PRE → ACTION handoff) ───────────

/** Opaque frame identifier — 'main' or 'iframe:<url>' — never a raw Playwright object. */
// NOSONAR — Rule #15 (no-primitive-returns) requires a named alias here.
export type ContextId = string;

/** Resolved element target — PRE discovered, ACTION executes via contextId. */
export interface IResolvedTarget {
  /** CSS/XPath selector for the element. */
  readonly selector: string;
  /** Opaque frame identifier — resolved by private registry inside executor. */
  readonly contextId: ContextId;
  /** Strategy that matched (xpath, placeholder, labelText, etc.). */
  readonly kind: string;
  /** Candidate value that was searched for. */
  readonly candidateValue: string;
}

/** LOGIN field keys — compiler-enforced, no raw strings. */
export const LOGIN_FIELDS = {
  PASSWORD: 'password',
  USERNAME: 'username',
  ID: 'id',
  CARD6: 'card6Digits',
  NUM: 'num',
  USER_CODE: 'userCode',
} as const;
/** Union of valid LOGIN field keys. */
export type LoginFieldKey = (typeof LOGIN_FIELDS)[keyof typeof LOGIN_FIELDS];

/** LOGIN phase discovery — resolved field targets from PRE. */
export interface ILoginFieldDiscovery {
  /** Pre-resolved field targets keyed by LoginFieldKey. */
  readonly targets: ReadonlyMap<LoginFieldKey, IResolvedTarget>;
  /** Form anchor discovered from password field. */
  readonly formAnchor: Option<IFormAnchor>;
  /** Opaque identifier of the frame where fields were found. */
  readonly activeFrameId: ContextId;
  /** Pre-resolved submit button target (contextId + selector). */
  readonly submitTarget: Option<IResolvedTarget>;
}

/**
 * Sealed action context — NO discovery methods, NO raw Page/Frame.
 * The ONLY browser interface is executor: IActionMediator.
 */
export interface IActionContext {
  readonly options: ScraperOptions;
  readonly credentials: ScraperCredentials;
  readonly companyId: CompanyTypes;
  readonly logger: ScraperLogger;
  readonly diagnostics: IDiagnosticsState;
  readonly config: IPipelineBankConfig;
  readonly fetchStrategy: Option<IFetchStrategy>;
  /** Sealed executor — fill, click, navigate. NO resolveField/resolveVisible. */
  readonly executor: Option<IActionMediator>;
  /** Headless-mode API mediator (set by buildInitialContext when isHeadless). */
  readonly apiMediator: Option<IApiMediator>;
  /** PRE-resolved login fields (LOGIN phase only). */
  readonly loginFieldDiscovery: Option<ILoginFieldDiscovery>;
  /** PreLogin discovery results. */
  readonly preLoginDiscovery: Option<IPreLoginDiscovery>;
  /** Dashboard state. */
  readonly dashboard: Option<IDashboardState>;
  /** Scrape discovery. */
  readonly scrapeDiscovery: Option<IScrapeDiscovery>;
  /** Account ids + records committed by ACCOUNT-RESOLVE.POST. */
  readonly accountDiscovery: Option<IAccountDiscovery>;
  /** TXN endpoint committed by DASHBOARD.FINAL — Phase 7e contract. */
  readonly txnEndpoint: Option<ITxnEndpoint>;
  /**
   * DASHBOARD-side TXN harvest committed by DASHBOARD.FINAL on a
   * separate ctx field — Phase 7f post-Hapoalim-regression follow-up.
   * Carries the pre-extracted records DASHBOARD captured during
   * ACTION + their scope so SCRAPE consumes the records directly when
   * the iteration's account matches, without re-fetching. Symmetric
   * to ACCOUNT-RESOLVE's IAccountDiscovery.records.
   */
  readonly dashboardTxnHarvest: Option<IDashboardTxnHarvest>;
  /**
   * Auth-discovery snapshot committed by AUTH-DISCOVERY.FINAL —
   * Mission 1 (CI quality hardening plan). Single source of truth
   * for "the run is ready to scrape": holds the auth token, origin,
   * site id, fetch headers, dashboard-readiness boolean, and session
   * cookie names. LOGIN/OTP-FILL no longer probe these signals
   * themselves (sealed by Missions 2/3); DASHBOARD/SCRAPE consume
   * the option via reads.
   */
  readonly authDiscovery: Option<IAuthDiscovery>;
  /**
   * OTP-TRIGGER snapshot committed by OTP-TRIGGER.FINAL — Mission 4.
   * Populated only when the OTP-TRIGGER phase ran (OTP-gated banks).
   * Carries `phoneHint`, `triggered`, `scopeValidated`. See
   * {@link IOtpTrigger} for the value shape.
   */
  readonly otpTrigger: Option<IOtpTrigger>;
  /** API context from DASHBOARD. */
  readonly api: Option<IApiFetchContext>;
  /** Login area ready signal. */
  readonly loginAreaReady: boolean;
}

/** Read-only context accumulated through the pipeline. */
interface IPipelineContext {
  readonly options: ScraperOptions;
  readonly credentials: ScraperCredentials;
  readonly companyId: CompanyTypes;
  readonly logger: ScraperLogger;
  readonly diagnostics: IDiagnosticsState;
  readonly config: IPipelineBankConfig;
  readonly fetchStrategy: Option<IFetchStrategy>;
  readonly mediator: Option<IElementMediator>;
  /** Headless-mode API mediator (set by buildInitialContext when isHeadless). */
  readonly apiMediator: Option<IApiMediator>;
  readonly browser: Option<IBrowserState>;
  readonly login: Option<ILoginState>;
  readonly dashboard: Option<IDashboardState>;
  readonly scrape: Option<IScrapeState>;
  /** Auto-discovered API context — injected by DASHBOARD phase. */
  readonly api: Option<IApiFetchContext>;
  /**
   * Phase-Gate Handshake Signal — set to true by PreLogin.POST.
   * LOGIN phase aborts immediately if this is false (form not yet validated).
   * Prevents cascading failures: no fill attempt before form is confirmed interactive.
   */
  readonly loginAreaReady: boolean;
  /** PreLogin.PRE discovery results — ACTION reads status instead of re-discovering. */
  readonly preLoginDiscovery: Option<IPreLoginDiscovery>;
  /** LOGIN.PRE field discovery — resolved selectors + form anchor. */
  readonly loginFieldDiscovery: Option<ILoginFieldDiscovery>;
  /** Scrape.PRE qualification results — ACTION reads qualified targets only. */
  readonly scrapeDiscovery: Option<IScrapeDiscovery>;
  /**
   * Account discovery committed by ACCOUNT-RESOLVE.POST. After Phase 7
   * the new dedicated phase is the single source of truth — runs after
   * auth (LOGIN or OTP-FILL) and before DASHBOARD, so DASHBOARD/SCRAPE
   * consume the option without re-running discovery against the global
   * capture pool. Strict SRP: each phase owns its data; no upstream
   * rediscovery.
   */
  readonly accountDiscovery: Option<IAccountDiscovery>;
  /**
   * TXN endpoint resolved by DASHBOARD.FINAL. Phase 7e: the single
   * source of truth for the per-account transactions API. SCRAPE
   * consumes this option without re-discovering — and SCRAPE never
   * imports `WK_API` or `WK_TXN`.
   */
  readonly txnEndpoint: Option<ITxnEndpoint>;
  /**
   * Pre-extracted TXN records harvested by DASHBOARD.FINAL during its
   * own POST/GET capture. Phase 7f follow-up: lets SCRAPE consume the
   * records DASHBOARD already saw without issuing a redundant fetch.
   * Mirrors {@link IAccountDiscovery.records} — the phase that
   * captured the response also normalizes and commits the records.
   *
   * <p>SCRAPE checks {@link IDashboardTxnHarvest.capturedAccountId}
   * vs the iteration's accountId before reusing; multi-account scopes
   * (`multiAccountScope: true`) are refused so each card iterates
   * its own fresh fetch.
   */
  readonly dashboardTxnHarvest: Option<IDashboardTxnHarvest>;
  /**
   * Auth-discovery snapshot committed by AUTH-DISCOVERY.FINAL —
   * Mission 1 of the CI quality hardening plan. Single source of
   * truth for "we are authenticated AND on the dashboard": carries
   * the auth token, origin, site id, fetch headers, dashboard-
   * readiness boolean, and session cookie names. Replaces the work
   * previously scattered across LOGIN.FINAL (LoginSignalProbe) and
   * OTP-FILL.PRE (maybeFastPathSuccess); LOGIN/OTP-FILL/OTP-TRIGGER
   * are sealed in Missions 2/3/4 and consume nothing from this
   * field — DASHBOARD/SCRAPE/ACCOUNT-RESOLVE read it as additive
   * input.
   */
  readonly authDiscovery: Option<IAuthDiscovery>;
  /**
   * OTP-TRIGGER snapshot committed by OTP-TRIGGER.FINAL — Mission 4
   * of the CI quality hardening plan. Populated only when the
   * OTP-TRIGGER phase ran (OTP-gated banks: Beinleumi, Hapoalim,
   * OneZero, Pepper). Carries the masked phone hint, the boolean
   * `triggered` signal that the click landed, and the scope-bound
   * validation outcome. Mirrors the slim value-type shape of
   * {@link IAuthDiscovery} and {@link IAccountDiscovery}.
   */
  readonly otpTrigger: Option<IOtpTrigger>;
}

/**
 * Account list committed by ACCOUNT-RESOLVE.POST. Format-stable so
 * SCRAPE.PRE can consume it without bank-specific coupling.
 *
 * <ul>
 *   <li>{@link ids} — qualified account / card identifiers, concat
 *       across every WK container surfaced from the picked endpoint
 *       (Phase 7d: VisaCal yields 4 cards + 3 bank accounts = 7
 *       ids).</li>
 *   <li>{@link records} — raw response payloads (display name,
 *       last-4, etc.), concatenated across the same containers.</li>
 *   <li>{@link containers} — per-WK-container split, e.g.
 *       `{cards: [...4], bankAccounts: [...3]}`. Empty when the
 *       picker fell back to root-array (Hapoalim shape) or to the
 *       request-side path.</li>
 *   <li>{@link endpointCaptureIndex} — diagnostic only. Identifies
 *       which capture POST picked. `0` when no endpoint was
 *       chosen (request-side fallback).</li>
 * </ul>
 */
interface IAccountDiscovery {
  readonly ids: readonly string[];
  readonly records: readonly Record<string, unknown>[];
  readonly containers: Readonly<Record<string, readonly Record<string, unknown>[]>>;
  readonly endpointCaptureIndex: number;
}

/**
 * Auth-discovery snapshot committed by AUTH-DISCOVERY.FINAL —
 * Mission 1 of the CI quality hardening plan.
 *
 * <p>Single source of truth for "we are authenticated AND on the
 * dashboard". Replaces the auth-token + dashboard-reveal work
 * previously scattered across LOGIN.FINAL (LoginSignalProbe) and
 * OTP-FILL.PRE (maybeFastPathSuccess). The phase mirrors
 * ACCOUNT-RESOLVE: PRE inventories, ACTION collects, POST
 * validates, FINAL emits this slim value type.
 *
 * <p>Fields:
 * <ul>
 *   <li>{@link authToken} — bearer token discovered in headers /
 *       response bodies / sessionStorage. `false` for banks that
 *       authenticate via cookies only (Discount, Hapoalim, …).</li>
 *   <li>{@link origin} — origin URL captured from request headers
 *       (e.g. `https://www.fibi.co.il`). `false` when no captures
 *       have an Origin header set.</li>
 *   <li>{@link siteId} — site-id header value (X-Site-Id, etc.).
 *       `false` when no bank-specific site-id is exposed.</li>
 *   <li>{@link headers} — full discovered fetch-header bag built
 *       from in-flight traffic; ready to pass to fetchStrategy.
 *       Empty object when no captures were available.</li>
 *   <li>{@link dashboardReady} — `true` when AUTH-DISCOVERY's reveal
 *       probe found at least one dashboard marker; `false` when the
 *       probe budget elapsed with no reveal.</li>
 *   <li>{@link sessionCookieNames} — names (not values) of session
 *       cookies present at AUTH-DISCOVERY entry. Used for telemetry
 *       only — never logged with values.</li>
 * </ul>
 */
interface IAuthDiscovery {
  readonly authToken: string | false;
  readonly origin: string | false;
  readonly siteId: string | false;
  readonly headers: Readonly<Record<string, string>>;
  readonly dashboardReady: boolean;
  readonly sessionCookieNames: readonly string[];
}

/**
 * Fail-loud codes emitted by AUTH-DISCOVERY.POST. Closed list,
 * exhaustive — every fail path uses one of these values.
 */
type AuthDiscoveryFailCode =
  | 'AUTH_DISCOVERY_SESSION_INVALID'
  | 'AUTH_DISCOVERY_DASHBOARD_NOT_READY'
  | 'AUTH_DISCOVERY_TOKEN_REQUIRED_AND_MISSING';

/**
 * Empty default for test paths. Mirrors EMPTY_AUTH_DISCOVERY's role
 * in the ACCOUNT-RESOLVE / TXN-endpoint patterns.
 */
const EMPTY_AUTH_DISCOVERY: IAuthDiscovery = {
  authToken: false,
  origin: false,
  siteId: false,
  headers: {},
  dashboardReady: false,
  sessionCookieNames: [],
};

/**
 * OTP-TRIGGER snapshot committed by OTP-TRIGGER.FINAL — Mission 4 of
 * the CI quality hardening plan. Carries the masked phone hint, the
 * boolean signal that the trigger click landed, and the scope-bound
 * validation outcome (target gone OR auth-domain HTTP 2xx since the
 * click). Mirrors the slim value-type shape used by
 * {@link IAccountDiscovery} and {@link IAuthDiscovery}: only fields
 * downstream consumers need; phase-internal artefacts emit via
 * telemetry events but do NOT travel on `ctx`.
 */
interface IOtpTrigger {
  /** Last 1-4 digits surfaced by PRE's phone-hint extractor. */
  readonly phoneHint: string;
  /** True when ACTION's clickElement resolved without throwing. */
  readonly triggered: boolean;
  /**
   * True when POST verified the trigger's scope-bound effect: the
   * trigger target either disappeared after the click OR a 2xx HTTP
   * response from the bank's auth domain landed since
   * `triggerClickedAt`.
   */
  readonly scopeValidated: boolean;
}

/**
 * Empty default for test paths. Mirrors EMPTY_AUTH_DISCOVERY's role
 * in the ACCOUNT-RESOLVE / TXN-endpoint patterns.
 */
const EMPTY_OTP_TRIGGER: IOtpTrigger = {
  phoneHint: '',
  triggered: false,
  scopeValidated: false,
};

/**
 * Empty-harvest sentinel for SCRAPE consumers when DASHBOARD did
 * not commit a harvest (no captured TXN body or harvest scope was
 * multi-account and the iteration's account doesn't match). Lives
 * next to {@link IDashboardTxnHarvest} so SCRAPE consumes it from
 * Types — kills the prior cross-zone SCRAPE → Dashboard import.
 */
const EMPTY_TXN_HARVEST: IDashboardTxnHarvest = {
  records: [],
  capturedAccountId: false,
  multiAccountScope: false,
};

/**
 * Field-name aliases resolved once per run by DASHBOARD.FINAL via
 * {@link resolveTxnEndpoint}. SCRAPE walks fresh per-account
 * responses by these aliases instead of importing `WK_TXN`. Phase 7e
 * shifts every TXN-side WK access into DASHBOARD's TxnParser; the
 * resolved aliases ride along as part of `ctx.txnEndpoint`.
 *
 * <p>`originalAmount`, `processedDate`, `balance` are nullable
 * (typed `string | false`) because not every bank exposes them
 * (card-family banks omit `balance`; Discount-class banks omit
 * `originalAmount`). Consumers test the boolean before walking.
 */
interface ITxnFieldMap {
  readonly date: string;
  readonly amount: string;
  readonly description: string;
  readonly currency: string;
  readonly identifier: string;
  readonly originalAmount: string | false;
  readonly processedDate: string | false;
  readonly balance: string | false;
}

/**
 * TXN endpoint contract committed by DASHBOARD.FINAL onto
 * `ctx.txnEndpoint`. Phase 7f: this is the slim, SCRAPE-facing
 * payload — only the fields SCRAPE actually consumes. Mirrors how
 * `IAccountDiscovery` carries only the SCRAPE-facing payload (ids,
 * records, containers).
 *
 * <ul>
 *   <li>`url`/`method` — the resolved endpoint (template URL).</li>
 *   <li>`templatePostData` — raw POST body for SCRAPE.PRE to clone
 *     and substitute per-account ids; `false` for GET banks.</li>
 *   <li>`fieldMap` — resolved field-name aliases (date / amount / …)
 *     so SCRAPE walks fresh responses without WK access.</li>
 *   <li>`pendingUrl` — pre-resolved pending-transactions API URL (or
 *     `false` when the bank doesn't expose pending).</li>
 *   <li>`billingUrl` — pre-resolved billing-fallback URL (or `false`
 *     when the bank's family doesn't carry the billing path).</li>
 * </ul>
 *
 * <p>DASHBOARD-internal artefacts (`captureIndex`,
 * `responseBodySample`, `normalizedRecords`, `pickerTier`,
 * `capturedPreClick`) live on {@link ITxnEndpointInternal} which
 * never travels on `ctx`; they emit via the
 * `dashboard.txnEndpoint.committed` telemetry event only.
 */
interface ITxnEndpoint {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly templatePostData: string | false;
  readonly fieldMap: ITxnFieldMap;
  readonly pendingUrl: string | false;
  readonly billingUrl: string | false;
}

/**
 * DASHBOARD-internal type returned by `resolveTxnEndpoint` and
 * consumed only inside `Mediator/Dashboard/`. Carries the slim
 * SCRAPE-facing `endpoint` plus the diagnostic / telemetry artefacts
 * that DASHBOARD needs to log but SCRAPE must not see.
 *
 * <p>`captureIndex` is the index of the picked capture inside the
 * network pool. `responseBodySample` is the raw captured body that
 * resolved the field-map. `normalizedRecords` is the pre-parsed
 * sample (used for buffered-account shortcuts inside DASHBOARD only).
 * `pickerTier` records which tier the picker picked from
 * (postWithShape / replayablePost / shapePassing / preClickFallback /
 * none). `capturedPreClick` is true when the resolver fell back to
 * the pre-click pool because the post-click pool was empty.
 */
interface ITxnEndpointInternal {
  readonly endpoint: ITxnEndpoint;
  readonly captureIndex: number;
  readonly responseBodySample: Readonly<Record<string, unknown>>;
  readonly normalizedRecords: readonly ITransaction[];
  readonly pickerTier: PickerTier;
  readonly capturedPreClick: boolean;
}

/**
 * Picker tier preference name. The picker walks the captured pool in
 * tier order and emits one of these labels per `discover.shapeAware`
 * event so the chosen URL's provenance is traceable from logs.
 */
type PickerTier = 'postWithShape' | 'replayablePost' | 'shapePassing' | 'preClickFallback' | 'none';

/**
 * DASHBOARD harvest committed by DASHBOARD.FINAL on a separate
 * `ctx.dashboardTxnHarvest` field — clean value-type pass of the
 * pre-extracted records. Mirrors `IAccountDiscovery.records`: the
 * phase that captured the response also normalizes the records and
 * commits them; downstream phases consume `readonly ITransaction[]`
 * without touching the captured body or `IDiscoveredEndpoint`.
 *
 * <p>Scope semantics:
 * <ul>
 *   <li>{@link capturedAccountId} = string — the captured request was
 *     scoped to one accountId (e.g. Hapoalim's
 *     `accountId=12-170-536347` URL param). SCRAPE applies the
 *     records only when the iteration's accountId is compatible
 *     (suffix match — handles raw-vs-display id formats).</li>
 *   <li>{@link capturedAccountId} = `false` — the captured request
 *     was unscoped (no per-account id in URL/body); applies to the
 *     single-account bank as a whole.</li>
 *   <li>{@link multiAccountScope} = true — the captured body bundled
 *     records for many accounts (`cards: [...]`, `accounts: [...]`).
 *     SCRAPE refuses reuse and falls through to per-account fetches
 *     so each card's records are correctly attributed.</li>
 * </ul>
 */
interface IDashboardTxnHarvest {
  readonly records: readonly ITransaction[];
  readonly capturedAccountId: string | false;
  readonly multiAccountScope: boolean;
}

/** Scrape phase discovery — qualification results from PRE step. */
interface IScrapeDiscovery {
  /** Card IDs that passed the behavioral probe (API returned success). */
  readonly qualifiedCards: readonly string[];
  /** Card IDs that failed the probe (API returned error). */
  readonly prunedCards: readonly string[];
  /** Discovered transaction template URL. */
  readonly txnTemplateUrl: string;
  /** Discovered transaction template POST body. */
  readonly txnTemplateBody: Record<string, unknown>;
  /** Billing months for 90-day replay. */
  readonly billingMonths: readonly string[];
  /** cardIndex → cardNumber display map (Isracard/Amex: last 4 digits). */
  readonly cardDisplayMap?: ReadonlyMap<string, string>;
  /** SPA URL for direct-fetch scrapers (false = no SPA navigation needed). */
  readonly spaUrl?: string | false;
  /** Raw account records from API discovery. */
  readonly rawAccountRecords?: readonly Record<string, unknown>[];
  /** Whether SPA navigation completed successfully. */
  readonly spaNavigated?: boolean;

  // ── DIRECT path fields (frozen discovery from PRE) ──

  /** Frozen snapshot of ALL captured endpoints for createFrozenNetwork. */
  readonly frozenEndpoints?: readonly IDiscoveredEndpoint[];
  /** Discovered account IDs from accounts endpoint. */
  readonly accountIds?: readonly string[];
  /** Transaction endpoint for account iteration. */
  readonly txnEndpoint?: ITxnEndpoint;
  /** Pre-cached auth token from DASHBOARD. */
  readonly cachedAuth?: string | false;
  /**
   * Dashboard navigation-click timestamp inherited from the live
   * network at freeze time. Lets the frozen network split captures
   * into pre-nav vs post-nav buckets so SCRAPE.PRE's discovery sees
   * the same post-nav-aware view as DASHBOARD.FINAL did. `false`
   * when no click was dispatched (banks like Hapoalim that fire
   * full-history at login) — the frozen network's soft-fallback then
   * exposes the full pool.
   */
  readonly dashboardClickAt?: number | false;
  /** Harvested sessionStorage key-value pairs. */
  readonly storageHarvest?: Readonly<Record<string, string>>;
  /** DIRECT_API: raw card/account response from DASHBOARD.ACTION. */
  readonly directApiResponse?: Record<string, unknown>;
  /** DIRECT_API: transaction endpoint URL from config. */
  readonly directApiTxnUrl?: string;
}

/**
 * Bootstrap context — IActionContext + browser.
 * Used by INIT/TERMINATE where no mediator exists yet but browser is available.
 */
export interface IBootstrapContext extends IActionContext {
  readonly browser: Option<IBrowserState>;
}

export type {
  ApiStrategyKind,
  AuthDiscoveryFailCode,
  IAccountDiscovery,
  IApiFetchContext,
  IAuthDiscovery,
  IBrowserState,
  IDashboardState,
  IDashboardTxnHarvest,
  IDiagnosticsState,
  ILoginState,
  IOtpTrigger,
  IPipelineContext,
  IScrapeDiscovery,
  IScrapeState,
  ITxnEndpoint,
  ITxnEndpointInternal,
  ITxnFieldMap,
  PickerTier,
};
export { API_STRATEGY, EMPTY_AUTH_DISCOVERY, EMPTY_OTP_TRIGGER, EMPTY_TXN_HARVEST };
