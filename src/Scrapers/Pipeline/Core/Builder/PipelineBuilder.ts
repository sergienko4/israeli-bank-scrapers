/** Pipeline builder — fluent builder for IPipelineDescriptor. */

import type { ScraperOptions } from '../../../Base/Interface.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import type { IApiDirectCallConfig } from '../../Mediator/ApiDirectCall/IApiDirectCallConfig.js';
import type { IApiDirectScrapeShape } from '../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { Procedure } from '../../Types/Procedure.js';
import type { IPipelineDescriptor } from '../PipelineDescriptor.js';
import type { LoginFn } from './PipelineAssembly.js';
import type { ScrapeFn } from './PipelineBuilderHelpers.js';
import { buildDescriptor } from './PipelineBuilderHelpers.js';
import {
  createEmptyState,
  type IBuilderState,
  setApiDirectConfig,
  setApiDirectScrape,
  setDeclarativeLogin,
  snapshotFields,
} from './PipelineBuilderSetters.js';

/** Fluent builder for pipeline descriptors. */
class PipelineBuilder {
  private readonly _s: IBuilderState = createEmptyState();

  /**
   * Set scraper options.
   * @param options - Scraper options.
   * @returns This builder.
   */
  public withOptions(options: ScraperOptions): this {
    this._s.options = options;
    return this;
  }

  /**
   * Enable browser lifecycle.
   * @returns This builder.
   */
  public withBrowser(): this {
    this._s.hasBrowser = true;
    return this;
  }

  /**
   * Enable Headless Strategy — API-only banks skip browser phases.
   * @returns This builder.
   */
  public withHeadlessMediator(): this {
    this._s.isHeadless = true;
    return this;
  }

  /**
   * Use declarative form-based login.
   * @param configOrFn - ILoginConfig or login function.
   * @returns This builder.
   */
  public withDeclarativeLogin(configOrFn: ILoginConfig | LoginFn): this {
    setDeclarativeLogin(this._s, configOrFn);
    return this;
  }

  /**
   * Replace LOGIN+OTP with a config-driven API-DIRECT-CALL phase.
   * @param config - Bank IApiDirectCallConfig literal.
   * @returns This builder.
   */
  public withApiDirect(config: IApiDirectCallConfig): this {
    setApiDirectConfig(this._s, config);
    return this;
  }

  /**
   * Enable PRE-LOGIN phase (form-reveal click before LOGIN).
   * @returns This builder.
   */
  public withPreLogin(): this {
    this._s.hasPreLogin = true;
    return this;
  }

  /**
   * Enable OTP trigger phase (clicks "Send SMS").
   * @returns This builder.
   */
  public withOtpTrigger(): this {
    this._s.hasOtpTrigger = true;
    return this;
  }

  /**
   * Enable OTP fill phase. Pass `required=false` for banks that may skip
   * OTP entirely (e.g. Hapoalim — device-remembered sessions).
   * @param required - Whether OTP fill is mandatory (default true).
   * @returns This builder.
   */
  public withOtpFill(required = true): this {
    this._s.hasOtpFill = true;
    this._s.otpFillRequired = required;
    return this;
  }

  /**
   * Set transaction scraping function.
   *
   * Legacy custom-function path — used by browser-mode banks and
   * (until Commits F/G) by API-direct banks too. API-direct banks
   * should call {@link PipelineBuilder.withApiDirectScrape} with a
   * SHAPE literal instead. The custom-function entry remains for
   * browser-mode banks; the API-direct callers are migrated off it
   * later in this PR.
   * @param fn - Scrape function.
   * @returns This builder.
   */
  public withScraper(fn: ScrapeFn): this {
    this._s.scrapeFn = fn;
    return this;
  }

  /**
   * Wire an API-direct scrape SHAPE into the pipeline. Replaces the
   * per-bank `withScraper(fn)` wrapper with a config-driven path —
   * the SHAPE literal carries customer/balance/transactions step
   * declarations, the ApiDirectScrape phase orchestrates them.
   *
   * Generic in `<TAcct, TCursor>` so bank-specific literals (e.g.
   * `IApiDirectScrapeShape<IPepperAcct, number>`) flow through
   * without contravariance errors at the builder boundary. The
   * variance is erased once stored on builder state.
   *
   * @param shape - Bank-supplied IApiDirectScrapeShape literal.
   * @returns This builder.
   */
  public withApiDirectScrape<TAcct, TCursor>(shape: IApiDirectScrapeShape<TAcct, TCursor>): this {
    setApiDirectScrape(this._s, shape as unknown as IApiDirectScrapeShape<unknown, unknown>);
    return this;
  }

  /**
   * Build the pipeline descriptor.
   * @returns The assembled descriptor.
   */
  public build(): Procedure<IPipelineDescriptor> {
    const fields = snapshotFields(this._s);
    const opts = this._s.options as ScraperOptions;
    return buildDescriptor(fields, opts);
  }
}

export type { LoginFn } from './PipelineAssembly.js';
export type { ScrapeFn } from './PipelineBuilderHelpers.js';
export { PipelineBuilder };
export { createPipelineBuilder } from './PipelineBuilderFactory.js';
