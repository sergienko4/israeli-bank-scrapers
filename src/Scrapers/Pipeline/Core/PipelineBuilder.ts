/**
 * Pipeline builder — fluent builder that constructs IPipelineDescriptor.
 * Build logic in PipelineBuilderHelpers.ts.
 * Validation in PipelineBuilderValidation.ts.
 */

import type { OtpConfig } from '../../Base/Config/LoginConfigTypes.js';
import type { ScraperOptions } from '../../Base/Interface.js';
import type { ILoginConfig } from '../../Base/Interfaces/Config/LoginConfig.js';
import type { Procedure } from '../Types/Procedure.js';
import type { IScrapeConfig } from '../Types/ScrapeConfig.js';
import type { LoginFn } from './BuilderAssembly.js';
import { buildDescriptor, type ScrapeFn } from './PipelineBuilderHelpers.js';
import {
  createEmptyState,
  type IBuilderState,
  setDeclarativeLogin,
  setFnLogin,
  setScrapeConfig,
  snapshotFields,
} from './PipelineBuilderSetters.js';
import type { IPipelineDescriptor } from './PipelineDescriptor.js';

/** Fluent builder for pipeline descriptors. */
class PipelineBuilder {
  private readonly _s: IBuilderState = createEmptyState();

  /**
   * Set scraper options (required).
   * @param options - Scraper options.
   * @returns This builder.
   */
  public withOptions(options: ScraperOptions): this {
    this._s.options = options;
    return this;
  }

  /**
   * Enable browser lifecycle.
   * @returns This builder with browser enabled.
   */
  public withBrowser(): this {
    this._s.hasBrowser = true;
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
   * Use native login (no browser).
   * @param fn - Login function.
   * @returns This builder.
   */
  public withNativeLogin(fn: LoginFn): this {
    setFnLogin(this._s, 'native', fn);
    return this;
  }

  /**
   * Add OTP phase.
   * @param config - OTP config.
   * @returns This builder.
   */
  public withOtp(config: OtpConfig): this {
    this._s.hasOtp = true;
    this._s.otpConfig = config;
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
   * Set generic scrape config.
   * @param config - The bank's IScrapeConfig.
   * @returns This builder.
   */
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
   * Build the pipeline descriptor.
   * @returns The assembled descriptor.
   */
  public build(): Procedure<IPipelineDescriptor> {
    const fields = snapshotFields(this._s);
    const opts = this._s.options as ScraperOptions;
    return buildDescriptor(fields, opts);
  }
}

/**
 * Factory: create a new PipelineBuilder.
 * @returns Fresh PipelineBuilder.
 */
function createPipelineBuilder(): PipelineBuilder {
  return Reflect.construct(PipelineBuilder, []);
}

export type { LoginFn as DirectPostLoginFn, LoginFn as NativeLoginFn, ScrapeFn };
export { createPipelineBuilder, PipelineBuilder };
