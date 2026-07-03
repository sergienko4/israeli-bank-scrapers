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
  setBrowserApiDirect,
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
   * Wire the full API-direct bank flow in one call — replaces
   * LOGIN+OTP with a config-driven API-DIRECT-CALL phase AND binds
   * the post-login SHAPE to the API-DIRECT-SCRAPE phase. The two
   * are coupled (one cannot run without the other for an API-direct
   * bank), so they share a single builder entry — one source of
   * truth, no risk of forgetting to wire the scrape after wiring
   * the login.
   *
   * Generic in `<TAcct, TCursor>` so bank-specific shape literals
   * (e.g. `IApiDirectScrapeShape<IPepperAcct, number>`) flow
   * through without contravariance errors at the builder boundary.
   *
   * @param config - Bank IApiDirectCallConfig literal (login path).
   * @param shape - Bank IApiDirectScrapeShape literal (scrape path).
   * @returns This builder.
   */
  public withApiDirect<TAcct, TCursor>(
    config: IApiDirectCallConfig,
    shape: IApiDirectScrapeShape<TAcct, TCursor>,
  ): this {
    setApiDirectConfig(this._s, config);
    setApiDirectScrape(this._s, shape as unknown as IApiDirectScrapeShape<unknown, unknown>);
    return this;
  }

  /**
   * Wire the HARD-MODEL post-auth path for a BROWSER bank. Keeps the
   * browser login phases (INIT/HOME/PRE-LOGIN/LOGIN/OTP/TERMINATE)
   * for WAF bypass, but replaces the generic AUTH-DISCOVERY /
   * ACCOUNT-RESOLVE / DASHBOARD / BALANCE-RESOLVE discovery chain
   * with the single API-DIRECT-SCRAPE phase driven by `shape`.
   * BIND-API-MEDIATOR binds an ApiMediator to the live login page so
   * the shape's REST calls ride the authenticated browser session.
   *
   * Generic in `<TAcct, TCursor>` so bank-specific shape literals
   * flow through without contravariance errors at the builder
   * boundary. Pair with `withDeclarativeLogin` for the login path.
   *
   * @param shape - Bank IApiDirectScrapeShape literal (scrape path).
   * @returns This builder.
   */
  public withBrowserApiDirect<TAcct, TCursor>(shape: IApiDirectScrapeShape<TAcct, TCursor>): this {
    setBrowserApiDirect(this._s, shape as unknown as IApiDirectScrapeShape<unknown, unknown>);
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
   * Set transaction scraping function — browser-mode banks only.
   * API-direct banks use {@link PipelineBuilder.withApiDirect}
   * which wires call + scrape together.
   * @param fn - Scrape function.
   * @returns This builder.
   */
  public withScraper(fn: ScrapeFn): this {
    this._s.scrapeFn = fn;
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
