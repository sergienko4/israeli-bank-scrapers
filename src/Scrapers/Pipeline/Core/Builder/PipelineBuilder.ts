/** Pipeline builder — fluent builder for IPipelineDescriptor. */

import type { ScraperOptions } from '../../../Base/Interface.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import type { IApiDirectCallConfig } from '../../Mediator/ApiDirectCall/IApiDirectCallConfig.js';
import type { IProxyAuth } from '../../Registry/Config/PipelineBankConfig.js';
import type { Procedure } from '../../Types/Procedure.js';
import type { IScrapeConfig } from '../../Types/ScrapeConfig.js';
import type { IPipelineDescriptor } from '../PipelineDescriptor.js';
import type { LoginFn } from './PipelineAssembly.js';
import { buildDescriptor, type ScrapeFn } from './PipelineBuilderHelpers.js';
import {
  createEmptyState,
  type IBuilderState,
  setApiDirectConfig,
  setDeclarativeLogin,
  setFnLogin,
  setScrapeConfig,
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
   * Use direct POST login.
   * @param fn - Login function.
   * @returns This builder.
   */
  public withDirectPostLogin(fn: LoginFn): this {
    setFnLogin(this._s, 'directPost', fn);
    return this;
  }

  /**
   * Use native login.
   * @param fn - Login function.
   * @returns This builder.
   */
  public withNativeLogin(fn: LoginFn): this {
    setFnLogin(this._s, 'native', fn);
    return this;
  }

  /**
   * Replace LOGIN + OTP-TRIGGER + OTP-FILL with a config-driven
   * API-DIRECT-CALL phase. Banks supply an IApiDirectCallConfig
   * literal — zero bank-side code beyond the literal + graphql
   * queries file (Rule #11, spec rev18 §B).
   * @param config - Bank IApiDirectCallConfig literal.
   * @returns This builder.
   */
  public withConfigDrivenLogin(config: IApiDirectCallConfig): this {
    setApiDirectConfig(this._s, config);
    return this;
  }

  /**
   * Enable OTP trigger phase (clicks "Send SMS").
   * @returns This builder.
   */
  public withLoginAndOtpTrigger(): this {
    this._s.hasOtp = true;
    this._s.hasOtpTrigger = true;
    return this;
  }

  /**
   * Enable OTP fill phase (fills code).
   * @returns This builder.
   */
  public withLoginAndOptCodeFill(): this {
    this._s.hasOtp = true;
    return this;
  }

  /**
   * Set transaction scraping function.
   * @param fn - Scrape function.
   * @returns This builder.
   */
  public withScraper(fn: ScrapeFn): this {
    this._s.scrapeFn = fn;
    return this;
  }

  /**
   * Set generic scrape config for bank-specific mapping.
   * @param config - The bank's IScrapeConfig with typed mappers.
   * @returns This builder.
   */
  public withScrapeConfig<TA extends object, TT extends object>(
    config: IScrapeConfig<TA, TT>,
  ): this {
    setScrapeConfig(this._s, config);
    return this;
  }

  /**
   * Set proxy auth params for proxy-based banks (Amex, Isracard).
   * @param auth - Proxy auth config with companyCode.
   * @returns This builder.
   */
  public withProxyAuth(auth: IProxyAuth): this {
    this._s.proxyAuth = auth;
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

export type { LoginFn as DirectPostLoginFn, LoginFn as NativeLoginFn, ScrapeFn };
export { PipelineBuilder };
export { createPipelineBuilder } from './PipelineBuilderFactory.js';
