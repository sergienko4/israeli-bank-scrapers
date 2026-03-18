/**
 * Pipeline builder — fluent builder that constructs IPipelineDescriptor.
 * Banks declare their pipeline via this builder.
 * Stub: build() returns minimal descriptor until Step 2.
 */

import type { OtpConfig } from '../Base/Config/LoginConfigTypes.js';
import type { ScraperOptions } from '../Base/Interface.js';
import type { ILoginConfig } from '../Base/Interfaces/Config/LoginConfig.js';
import ScraperError from '../Base/ScraperError.js';
import type { IPipelineDescriptor } from './PipelineDescriptor.js';
import type { IPhaseDefinition } from './Types/Phase.js';
import type { IPipelineContext } from './Types/PipelineContext.js';
import type { Procedure } from './Types/Procedure.js';

/** Function signature for direct-POST login (Amex/Isracard). */
type DirectPostLoginFn = (
  ctx: IPipelineContext,
  credentials: Record<string, string>,
) => Promise<Procedure<IPipelineContext>>;

/** Function signature for native login (OneZero, no browser). */
type NativeLoginFn = (
  ctx: IPipelineContext,
  credentials: Record<string, string>,
) => Promise<Procedure<IPipelineContext>>;

/** Function signature for bank-specific transaction scraping. */
type ScrapeFn = (ctx: IPipelineContext) => Promise<Procedure<IPipelineContext>>;

/** Login mode discriminator. */
type LoginMode = 'none' | 'declarative' | 'directPost' | 'native';

/** Fluent builder for pipeline descriptors. */
class PipelineBuilder {
  private _options: ScraperOptions | false = false;

  private _hasBrowser = false;

  private _loginMode: LoginMode = 'none';

  private _loginConfig: ILoginConfig | false = false;

  private _loginFn: DirectPostLoginFn | NativeLoginFn | false = false;

  private _otpConfig: OtpConfig | false = false;

  private _hasOtp = false;

  private _hasDashboard = false;

  private _scrapeFn: ScrapeFn | false = false;

  private _hasScraper = false;

  /**
   * Set scraper options (required).
   * @param options - Scraper configuration.
   * @returns This builder for chaining.
   */
  public withOptions(options: ScraperOptions): this {
    this._options = options;
    return this;
  }

  /**
   * Enable browser lifecycle (init + terminate phases).
   * @returns This builder for chaining.
   */
  public withBrowser(): this {
    this._hasBrowser = true;
    return this;
  }

  /**
   * Use declarative form-based login (SelectorResolver).
   * @param config - Bank's ILoginConfig.
   * @returns This builder for chaining.
   */
  public withDeclarativeLogin(config: ILoginConfig): this {
    this.assertNoLoginMode();
    this._loginMode = 'declarative';
    this._loginConfig = config;
    return this;
  }

  /**
   * Use direct POST login (browser + API POST, e.g. Amex/Isracard).
   * @param fn - Login function.
   * @returns This builder for chaining.
   */
  public withDirectPostLogin(fn: DirectPostLoginFn): this {
    this.assertNoLoginMode();
    this._loginMode = 'directPost';
    this.storeLoginFn(fn);
    return this;
  }

  /**
   * Use native login (no browser, e.g. OneZero).
   * @param fn - Login function.
   * @returns This builder for chaining.
   */
  public withNativeLogin(fn: NativeLoginFn): this {
    this.assertNoLoginMode();
    this._loginMode = 'native';
    this.storeLoginFn(fn);
    return this;
  }

  /**
   * Add OTP phase.
   * @param config - OTP configuration.
   * @returns This builder for chaining.
   */
  public withOtp(config: OtpConfig): this {
    this._hasOtp = true;
    this.storeOtpConfig(config);
    return this;
  }

  /**
   * Add dashboard wait phase.
   * @returns This builder for chaining.
   */
  public withDashboard(): this {
    this._hasDashboard = true;
    return this;
  }

  /**
   * Set transaction scraping function.
   * @param fn - Bank-specific scrape function.
   * @returns This builder for chaining.
   */
  public withScraper(fn: ScrapeFn): this {
    this._hasScraper = true;
    this.storeScrapeFn(fn);
    return this;
  }

  /**
   * Build the pipeline descriptor.
   * @returns The assembled pipeline descriptor.
   */
  public build(): IPipelineDescriptor {
    if (this._options === false) {
      throw new ScraperError('PipelineBuilder: withOptions() is required');
    }
    if (this._loginMode === 'none') {
      throw new ScraperError('PipelineBuilder: a login mode is required');
    }
    this.validateConfig();
    const phases: IPhaseDefinition<IPipelineContext, IPipelineContext>[] = [];
    return { options: this._options, phases };
  }

  /**
   * Validate that stored config references are consistent.
   * @returns The count of configured phases.
   */
  private validateConfig(): number {
    const hasBrowser = this._hasBrowser;
    const hasLogin = this._loginConfig || this._loginFn;
    const hasOtp = this._hasOtp && this._otpConfig;
    const hasDashboard = this._hasDashboard;
    const hasScraper = this._hasScraper && this._scrapeFn;
    const configs = [hasBrowser, hasLogin, hasOtp, hasDashboard, hasScraper];
    return configs.filter(Boolean).length;
  }

  /**
   * Assert no login mode has been set yet.
   * @returns True if no login mode is set.
   * @throws If a login mode was already configured.
   */
  private assertNoLoginMode(): true {
    if (this._loginMode !== 'none') {
      throw new ScraperError('PipelineBuilder: login mode already set — only one allowed');
    }
    return true;
  }

  /**
   * Store a login function reference for later phase construction.
   * @param fn - The login function to store.
   * @returns True after storing.
   */
  private storeLoginFn(fn: DirectPostLoginFn | NativeLoginFn): true {
    this._loginFn = fn;
    return true;
  }

  /**
   * Store an OTP config reference for later phase construction.
   * @param config - The OTP config to store.
   * @returns True after storing.
   */
  private storeOtpConfig(config: OtpConfig): true {
    this._otpConfig = config;
    return true;
  }

  /**
   * Store a scrape function reference for later phase construction.
   * @param fn - The scrape function to store.
   * @returns True after storing.
   */
  private storeScrapeFn(fn: ScrapeFn): true {
    this._scrapeFn = fn;
    return true;
  }
}

export type { DirectPostLoginFn, NativeLoginFn, ScrapeFn };
export { PipelineBuilder };
