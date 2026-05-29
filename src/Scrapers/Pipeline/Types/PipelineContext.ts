/**
 * Pipeline context — immutable, accumulated across phases.
 * Each phase returns a NEW context with spread.
 * All config injected via DI — no direct imports of SCRAPER_CONFIGURATION.
 */

import type { CompanyTypes } from '../../../Definitions.js';
import type { ScraperCredentials, ScraperOptions } from '../../Base/Interface.js';
import type { IApiMediator } from '../Mediator/Api/ApiMediator.js';
import type { IActionMediator, IElementMediator } from '../Mediator/Elements/ElementMediator.js';
import type { IPipelineBankConfig } from '../Registry/Config/PipelineBankConfig.js';
import type { IFetchStrategy } from '../Strategy/Fetch/FetchStrategy.js';
import type { ScraperLogger } from './Debug.js';
import type { IAccountDiscovery } from './Domain/AccountDiscoveryTypes.js';
import type { IApiFetchContext } from './Domain/ApiFetchContext.js';
import type { IAuthDiscovery } from './Domain/AuthDiscoveryTypes.js';
import type {
  IBalanceExtracted,
  IBalanceFetchPlanEntry,
  IBalanceValidation,
} from './Domain/BalanceTypes.js';
import type { IBrowserState } from './Domain/BrowserState.js';
import type { IDashboardState } from './Domain/DashboardState.js';
import type { IDiagnosticsState } from './Domain/DiagnosticsState.js';
import type { ILoginState } from './Domain/LoginState.js';
import type { ILoginFieldDiscovery } from './Domain/LoginTypes.js';
import type { IOtpFill, IOtpTrigger } from './Domain/OtpTypes.js';
import type { IPreLoginDiscovery } from './Domain/PreLoginTypes.js';
import type { IScrapeDiscovery } from './Domain/ScrapeDiscoveryTypes.js';
import type { IScrapeState } from './Domain/ScrapeState.js';
import type { ITxnEndpoint } from './Domain/TxnEndpointTypes.js';
import type { IDashboardTxnHarvest } from './Domain/TxnHarvestTypes.js';
import type { Option } from './Option.js';

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
  /** BALANCE-RESOLVE.pre output (v6) — per-bank-account fetch plan. */
  readonly balanceFetchPlan: Option<readonly IBalanceFetchPlanEntry[]>;
  /** BALANCE-RESOLVE.action output (v6) — responses keyed by bankAccountUniqueId. */
  readonly balanceResponsesByBankAccount: Option<ReadonlyMap<string, unknown>>;
  /** BALANCE-RESOLVE.action output — extracted outcome per accountId. */
  readonly balanceExtracted: Option<IBalanceExtracted>;
  /** BALANCE-RESOLVE.post output — validation report. */
  readonly balanceValidation: Option<IBalanceValidation>;
  /** BALANCE-RESOLVE.final output — final balance map per accountId. */
  readonly balanceResolution: Option<ReadonlyMap<string, number>>;
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
  /**
   * OTP-FILL emit — Mission M4.F1. Populated by OTP-FILL.PRE
   * (whether the form was found, soft-skipped, or MOCK-bypassed).
   * Carries `urlBeforeSubmit` as a baton so AUTH-DISCOVERY.FINAL
   * reads the SAME shape across all 5 auth-ladder flows.
   */
  readonly otpFill: Option<IOtpFill>;
  /**
   * BALANCE-RESOLVE.pre output (v6) — per-bank-account fetch plan.
   * One entry per unique bankAccountUniqueId derived from SCRAPE's
   * accountIdentities + balanceFetchTemplate.
   */
  readonly balanceFetchPlan: Option<readonly IBalanceFetchPlanEntry[]>;
  /**
   * BALANCE-RESOLVE.action output (v6) — fetched response bodies
   * keyed by bankAccountUniqueId. Consumed by the same sub-step to
   * map per-card balances via the cardUniqueId/cardDisplayId triple
   * in {@link IAccountIdentity}.
   */
  readonly balanceResponsesByBankAccount: Option<ReadonlyMap<string, unknown>>;
  /**
   * BALANCE-RESOLVE.action output — per-account extraction outcome
   * (finite number on success, `'MISS'` when extractor scanned
   * every candidate without a hit).
   */
  readonly balanceExtracted: Option<IBalanceExtracted>;
  /**
   * BALANCE-RESOLVE.post output — validation partition of the
   * extracted outcomes into resolved vs missed.
   */
  readonly balanceValidation: Option<IBalanceValidation>;
  /**
   * BALANCE-RESOLVE.final output — final per-account balance map
   * consumed by PipelineResult to populate IScraperScrapingResult.
   * MISS entries collapse to 0; legitimate zero balances preserve 0.
   */
  readonly balanceResolution: Option<ReadonlyMap<string, number>>;
}

/**
 * Bootstrap context — IActionContext + browser.
 * Used by INIT/TERMINATE where no mediator exists yet but browser is available.
 */
export interface IBootstrapContext extends IActionContext {
  readonly browser: Option<IBrowserState>;
}

export type { IPipelineContext };
// Direct re-exports — Sonar S7763 / `unicorn/prefer-export-from`.
// These symbols are imported here ONLY to be re-emitted through the
// barrel; routing them via `export type ... from` removes the
// redundant local binding and matches the value-export style below.
export { type IAccountDiscovery } from './Domain/AccountDiscoveryTypes.js';
export { type IApiFetchContext } from './Domain/ApiFetchContext.js';
export { API_STRATEGY, type ApiStrategyKind } from './Domain/ApiStrategy.js';
export type { AuthDiscoveryFailCode, IAuthDiscovery } from './Domain/AuthDiscoveryTypes.js';
export { EMPTY_AUTH_DISCOVERY } from './Domain/AuthDiscoveryTypes.js';
export type {
  BalanceExtractionOutcome,
  IAccountIdentity,
  IBalanceExtracted,
  IBalanceFetchPlanEntry,
  IBalanceFetchRequest,
  IBalanceFetchTemplate,
  IBalanceValidation,
} from './Domain/BalanceTypes.js';
export { type IBillingCycle, type IBillingCycleCatalog } from './Domain/BillingCycleTypes.js';
export { type IBrowserState } from './Domain/BrowserState.js';
export { type IDashboardState } from './Domain/DashboardState.js';
export { type IDiagnosticsState } from './Domain/DiagnosticsState.js';
export { type ILoginState } from './Domain/LoginState.js';
export type { ILoginFieldDiscovery, LoginFieldKey } from './Domain/LoginTypes.js';
export { LOGIN_FIELDS } from './Domain/LoginTypes.js';
export {
  EMPTY_OTP_FILL,
  EMPTY_OTP_TRIGGER,
  type IOtpFill,
  type IOtpTrigger,
} from './Domain/OtpTypes.js';
export type { IPreLoginDiscovery, IResolvedTarget, RevealStatus } from './Domain/PreLoginTypes.js';
export { type IScrapeDiscovery } from './Domain/ScrapeDiscoveryTypes.js';
export { type IScrapeState } from './Domain/ScrapeState.js';
export type {
  ITxnEndpoint,
  ITxnEndpointInternal,
  ITxnFieldMap,
  PickerTier,
} from './Domain/TxnEndpointTypes.js';
export { EMPTY_TXN_HARVEST, type IDashboardTxnHarvest } from './Domain/TxnHarvestTypes.js';
