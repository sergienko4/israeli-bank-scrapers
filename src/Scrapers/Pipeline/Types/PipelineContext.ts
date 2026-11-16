/**
 * Pipeline context — immutable, accumulated across phases.
 * Each phase returns a NEW context with spread.
 * All config injected via DI — no direct imports of a global scraper configuration.
 */

import type { CompanyTypes } from '../../../Definitions.js';
import type { ScraperCredentials, ScraperOptions } from '../../Base/Interface.js';
import type { IDurableAuthState } from './Domain/DurableAuthState.js';
import type { ScraperLogger } from './Domain/ScraperLogger.js';
import type { IScrapeState } from './Domain/ScrapeState.js';
import type { Option } from './Option.js';

/**
 * Mediator capabilities the context exposes to phases. The concrete
 * `IApiMediator` is wider; this port keeps Types independent of Mediator.
 */
interface IPipelineMediator {
  /** Session-context snapshot installed by the login flow. */
  getSessionContext(): Readonly<Record<string, unknown>>;
  /** Release any owned transport resources. */
  readonly dispose?: () => Promise<void>;
}

/** Transport slice the phone normaliser reads without depending on Registry. */
interface IPipelineContextTransport {
  readonly phoneNumberFormat?:
    'international-plus' | 'international-dash' | 'international-flat' | 'local-only';
}

/** Registry config slice the context exposes without depending on Registry. */
interface IPipelineContextConfig {
  readonly urls: { readonly base: string };
  readonly transport?: IPipelineContextTransport;
}

/** Read-only context accumulated through the pipeline. */
interface IPipelineContext {
  readonly options: ScraperOptions;
  readonly credentials: ScraperCredentials;
  readonly companyId: CompanyTypes;
  readonly logger: ScraperLogger;
  readonly config: IPipelineContextConfig;
  /**
   * Upper bound of the scrape window. `none()` on the ordinary pass, where
   * every shape reaches today; set by the coverage backfill to re-request an
   * older slice after a gap. Lives here rather than on `ScraperOptions`
   * because it is an internal retry detail, not part of the public API.
   */
  readonly windowEnd: Option<Date>;
  /** API mediator driving every HTTP call (set by buildInitialContext). */
  readonly apiMediator: Option<IPipelineMediator>;
  /** Accounts and transactions committed by the API-direct scrape phase. */
  readonly scrape: Option<IScrapeState>;
  /**
   * Long-lived re-login artifact captured by the API-direct login chain.
   * Feeds the single public `result.persistentOtpToken`.
   */
  readonly durableAuth: Option<IDurableAuthState>;
  /**
   * Final per-account balance map consumed by PipelineResult to populate
   * IScraperScrapingResult. Legitimate zero balances preserve 0.
   */
  readonly balanceResolution: Option<ReadonlyMap<string, number>>;
}

/**
 * Context handed to shape callbacks and phase actions. Kept as a named alias
 * so shape code reads as "the context an action receives".
 */
type IActionContext = IPipelineContext;

export type { IActionContext, IPipelineContext };
export { type IScrapeState } from './Domain/ScrapeState.js';
