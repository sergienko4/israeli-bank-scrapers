/**
 * Pipeline context — immutable, accumulated across phases.
 * Each phase returns a NEW context with spread.
 * All config injected via DI — no direct imports of SCRAPER_CONFIGURATION.
 */

import type { BrowserContext, Frame, Page } from 'playwright-core';

import type { ScraperLogger } from '../../../Common/Debug.js';
import type { CompanyTypes } from '../../../Definitions.js';
import type { ITransactionsAccount } from '../../../Transactions.js';
import type { ScraperCredentials, ScraperOptions } from '../../Base/Interface.js';
import type { IBankScraperConfig } from '../../Registry/Config/ScraperConfigDefaults.js';
import type { IElementMediator } from '../Mediator/ElementMediator.js';
import type { IFetchStrategy } from '../Strategy/FetchStrategy.js';
import type { Option } from './Option.js';
import type { Procedure } from './Procedure.js';

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
  readonly cleanups: readonly (() => Promise<boolean>)[];
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
}

/** Scrape phase result context. */
interface IScrapeState {
  readonly accounts: readonly ITransactionsAccount[];
}

/** Diagnostics state — tracks timing and breadcrumbs. */
interface IDiagnosticsState {
  readonly loginUrl: PageUrlStr;
  readonly finalUrl: Option<string>;
  readonly loginStartMs: TimestampMs;
  readonly fetchStartMs: Option<number>;
  readonly lastAction: DiagnosticStr;
  readonly pageTitle: Option<string>;
  readonly warnings: readonly string[];
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
}

/** Phase-Gate signal: true means FindLoginArea.POST confirmed the form is interactive. */
type LoginAreaReadySignal = boolean;

/** Read-only context accumulated through the pipeline. */
interface IPipelineContext {
  readonly options: ScraperOptions;
  readonly credentials: ScraperCredentials;
  readonly companyId: CompanyTypes;
  readonly logger: ScraperLogger;
  readonly diagnostics: IDiagnosticsState;
  readonly config: IBankScraperConfig;
  readonly fetchStrategy: Option<IFetchStrategy>;
  readonly mediator: Option<IElementMediator>;
  readonly browser: Option<IBrowserState>;
  readonly login: Option<ILoginState>;
  readonly dashboard: Option<IDashboardState>;
  readonly scrape: Option<IScrapeState>;
  /** Auto-discovered API context — injected by DASHBOARD phase. */
  readonly api: Option<IApiFetchContext>;
  /**
   * Phase-Gate Handshake Signal — set to true by FindLoginArea.POST.
   * LOGIN phase aborts immediately if this is false (form not yet validated).
   * Prevents cascading failures: no fill attempt before form is confirmed interactive.
   */
  readonly loginAreaReady: LoginAreaReadySignal;
}

export type {
  IApiFetchContext,
  IBrowserState,
  IDashboardState,
  IDiagnosticsState,
  ILoginState,
  IPipelineContext,
  IScrapeState,
};
