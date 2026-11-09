/**
 * Pipeline context — immutable, accumulated across phases.
 * Each phase returns a NEW context with spread.
 * All config injected via DI — no direct imports of a global scraper configuration.
 */

import type { CompanyTypes } from '../../../Definitions.js';
import type { ScraperCredentials, ScraperOptions } from '../../Base/Interface.js';
import type { ScraperLogger } from '../Logging/Debug.js';
import type { IApiMediator } from '../Mediator/Api/ApiMediator.js';
import type { IPipelineBankConfig } from '../Registry/Config/PipelineBankConfig.js';
import type { IDurableAuthState } from './Domain/DurableAuthState.js';
import type { IScrapeState } from './Domain/ScrapeState.js';
import type { Option } from './Option.js';

/** Read-only context accumulated through the pipeline. */
interface IPipelineContext {
  readonly options: ScraperOptions;
  readonly credentials: ScraperCredentials;
  readonly companyId: CompanyTypes;
  readonly logger: ScraperLogger;
  readonly config: IPipelineBankConfig;
  /**
   * Upper bound of the scrape window. `none()` on the ordinary pass, where
   * every shape reaches today; set by the coverage backfill to re-request an
   * older slice after a gap. Lives here rather than on `ScraperOptions`
   * because it is an internal retry detail, not part of the public API.
   */
  readonly windowEnd: Option<Date>;
  /** API mediator driving every HTTP call (set by buildInitialContext). */
  readonly apiMediator: Option<IApiMediator>;
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
