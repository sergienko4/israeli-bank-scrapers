/**
 * Pipeline context — immutable, accumulated across phases.
 * Each phase returns a NEW context with spread.
 * All config injected via DI — no direct imports of SCRAPER_CONFIGURATION.
 */

import type { BrowserContext, Frame, Page } from 'playwright-core';

import type { CompanyTypes } from '../../../Definitions.js';
import type { ITransactionsAccount } from '../../../Transactions.js';
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

/** Whether the dashboard page is fully ready after login. */
type PageReadyFlag = boolean;
/** URL string of a page captured during the pipeline. */
type PageUrlStr = string;
/** Epoch-ms timestamp recorded during a pipeline phase. */
type TimestampMs = number;
/** Short diagnostic breadcrumb string (last phase action). */
type DiagnosticStr = string;

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
  readonly isReady: PageReadyFlag;
  readonly pageUrl: PageUrlStr;
  readonly trafficPrimed: PageReadyFlag;
}

/** Scrape phase result context. */
interface IScrapeState {
  readonly accounts: readonly ITransactionsAccount[];
}

/** API strategy kind — DIRECT (SPA traffic) or PROXY (gateway). */
const API_STRATEGY = {
  DIRECT: 'DIRECT',
  PROXY: 'PROXY',
} as const;

/** Union type for API strategy. */
type ApiStrategyKind = (typeof API_STRATEGY)[keyof typeof API_STRATEGY];

/** Diagnostics state — tracks timing and breadcrumbs. */
interface IDiagnosticsState {
  readonly loginUrl: PageUrlStr;
  readonly finalUrl: Option<string>;
  readonly loginStartMs: TimestampMs;
  readonly fetchStartMs: Option<number>;
  readonly lastAction: DiagnosticStr;
  readonly pageTitle: Option<string>;
  readonly warnings: readonly string[];
  /** Target URL extracted in DASHBOARD.PRE for navigation. */
  readonly dashboardTargetUrl?: PageUrlStr;
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
  readonly dashboardTrafficExists?: PageReadyFlag;
  /** Auth token discovered from iframe sessionStorage in DASHBOARD.FINAL. */
  readonly discoveredAuth?: string | false;
  /** How the login form was submitted — used by POST to decide validation. */
  readonly submitMethod?: 'enter' | 'click' | 'both';
  /** API strategy discovered in LOGIN.FINAL — DIRECT (SPA) or PROXY (gateway). */
  readonly apiStrategy?: ApiStrategyKind;
  /** Proxy/gateway base URL discovered in LOGIN.FINAL for PROXY strategy. */
  readonly discoveredProxyUrl?: PageUrlStr;
}

/** Auto-discovered API fetch context — injected by DASHBOARD phase. */
interface IApiFetchContext {
  /** Fetch POST with auto-injected auth + headers. Bank provides URL + body only. */
  fetchPost<T>(url: string, body: Record<string, string | object>): Promise<Procedure<T>>;
  /** Fetch GET with auto-injected auth + headers. Bank provides URL only. */
  fetchGet<T>(url: string): Promise<Procedure<T>>;
  /** Discovered accounts endpoint URL (or false if not found in traffic). */
  readonly accountsUrl: string | false;
  /** Discovered transactions endpoint URL (or false). */
  readonly transactionsUrl: string | false;
  /** Discovered balance endpoint URL (or false). */
  readonly balanceUrl: string | false;
  /** Discovered pending endpoint URL (or false). */
  readonly pendingUrl: string | false;
  /** Discovered proxy/gateway base URL for API calls (e.g. ProxyRequestHandler). */
  readonly proxyUrl: string | false;
  /** Config-fallback transaction URL — used when discovery finds no txn endpoint. */
  readonly configTransactionsUrl?: string | false;
}

/** Phase-Gate signal: true means PreLogin.POST confirmed the form is interactive. */
type LoginAreaReadySignal = boolean;

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
export type ContextId = string;

/** Resolved element target — PRE discovered, ACTION executes via contextId. */
export interface IResolvedTarget {
  /** CSS/XPath selector for the element. */
  readonly selector: PageUrlStr;
  /** Opaque frame identifier — resolved by private registry inside executor. */
  readonly contextId: ContextId;
  /** Strategy that matched (xpath, placeholder, labelText, etc.). */
  readonly kind: PageUrlStr;
  /** Candidate value that was searched for. */
  readonly candidateValue: PageUrlStr;
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
  /** API context from DASHBOARD. */
  readonly api: Option<IApiFetchContext>;
  /** Login area ready signal. */
  readonly loginAreaReady: LoginAreaReadySignal;
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
  readonly loginAreaReady: LoginAreaReadySignal;
  /** PreLogin.PRE discovery results — ACTION reads status instead of re-discovering. */
  readonly preLoginDiscovery: Option<IPreLoginDiscovery>;
  /** LOGIN.PRE field discovery — resolved selectors + form anchor. */
  readonly loginFieldDiscovery: Option<ILoginFieldDiscovery>;
  /** Scrape.PRE qualification results — ACTION reads qualified targets only. */
  readonly scrapeDiscovery: Option<IScrapeDiscovery>;
}

/** Scrape phase discovery — qualification results from PRE step. */
interface IScrapeDiscovery {
  /** Card IDs that passed the behavioral probe (API returned success). */
  readonly qualifiedCards: readonly string[];
  /** Card IDs that failed the probe (API returned error). */
  readonly prunedCards: readonly string[];
  /** Discovered transaction template URL. */
  readonly txnTemplateUrl: PageUrlStr;
  /** Discovered transaction template POST body. */
  readonly txnTemplateBody: Record<string, unknown>;
  /** Billing months for 90-day replay. */
  readonly billingMonths: readonly string[];
  /** cardIndex → cardNumber display map (Isracard/Amex: last 4 digits). */
  readonly cardDisplayMap?: ReadonlyMap<string, string>;
  /** SPA URL for direct-fetch scrapers (false = no SPA navigation needed). */
  readonly spaUrl?: PageUrlStr | false;
  /** Raw account records from API discovery. */
  readonly rawAccountRecords?: readonly Record<string, unknown>[];
  /** Whether SPA navigation completed successfully. */
  readonly spaNavigated?: PageReadyFlag;

  // ── DIRECT path fields (frozen discovery from PRE) ──

  /** Frozen snapshot of ALL captured endpoints for createFrozenNetwork. */
  readonly frozenEndpoints?: readonly IDiscoveredEndpoint[];
  /** Discovered account IDs from accounts endpoint. */
  readonly accountIds?: readonly string[];
  /** Transaction endpoint for account iteration. */
  readonly txnEndpoint?: IDiscoveredEndpoint | false;
  /** Pre-cached auth token from DASHBOARD. */
  readonly cachedAuth?: string | false;
  /** Harvested sessionStorage key-value pairs. */
  readonly storageHarvest?: Readonly<Record<string, string>>;
  /** DIRECT_API: raw card/account response from DASHBOARD.ACTION. */
  readonly directApiResponse?: Record<string, unknown>;
  /** DIRECT_API: transaction endpoint URL from config. */
  readonly directApiTxnUrl?: PageUrlStr;
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
  IApiFetchContext,
  IBrowserState,
  IDashboardState,
  IDiagnosticsState,
  ILoginState,
  IPipelineContext,
  IScrapeDiscovery,
  IScrapeState,
};
export { API_STRATEGY };
