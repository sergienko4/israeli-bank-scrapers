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
  readonly isReady: boolean;
  readonly pageUrl: string;
}

/** Scrape phase result context. */
interface IScrapeState {
  readonly accounts: readonly ITransactionsAccount[];
}

/** Diagnostics state — tracks timing and breadcrumbs. */
interface IDiagnosticsState {
  readonly loginUrl: string;
  readonly finalUrl: Option<string>;
  readonly loginStartMs: number;
  readonly fetchStartMs: Option<number>;
  readonly lastAction: string;
  readonly pageTitle: Option<string>;
  readonly warnings: readonly string[];
}

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
}

export type {
  IBrowserState,
  IDashboardState,
  IDiagnosticsState,
  ILoginState,
  IPipelineContext,
  IScrapeState,
};
