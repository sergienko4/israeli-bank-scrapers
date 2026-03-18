/**
 * Pipeline builder — fluent builder that constructs IPipelineDescriptor.
 * Banks declare their pipeline via this builder.
 * build() assembles IPhaseDefinitions in order: init → login → otp → dashboard → scrape.
 */

import type { OtpConfig } from '../Base/Config/LoginConfigTypes.js';
import type { ScraperOptions } from '../Base/Interface.js';
import type { ILoginConfig } from '../Base/Interfaces/Config/LoginConfig.js';
import ScraperError from '../Base/ScraperError.js';
import { DASHBOARD_STEP } from './Phases/DashboardPhase.js';
import { DECLARATIVE_LOGIN_STEP } from './Phases/DeclarativeLoginPhase.js';
import { DIRECT_POST_LOGIN_STEP } from './Phases/DirectPostLoginPhase.js';
import { INIT_STEP } from './Phases/InitPhase.js';
import { NATIVE_LOGIN_STEP } from './Phases/NativeLoginPhase.js';
import { OTP_STEP } from './Phases/OtpPhase.js';
import { SCRAPE_STEP } from './Phases/ScrapePhase.js';
import { TERMINATE_STEP } from './Phases/TerminatePhase.js';
import type { IPipelineDescriptor } from './PipelineDescriptor.js';
import { none } from './Types/Option.js';
import type { IPhaseDefinition, PhaseName } from './Types/Phase.js';
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

/** Shorthand for a phase with IPipelineContext as both in and out. */
type CtxPhase = IPhaseDefinition<IPipelineContext, IPipelineContext>;

/**
 * Create a phase with only an action step (no pre/post).
 * @param name - The phase name.
 * @param action - The action step.
 * @returns A phase definition with pre and post set to none().
 */
function actionOnly(name: PhaseName, action: CtxPhase['action']): CtxPhase {
  return { name, pre: none(), action, post: none() };
}

/** Login step lookup map. */
const LOGIN_STEPS: Record<string, CtxPhase['action']> = {
  declarative: DECLARATIVE_LOGIN_STEP,
  directPost: DIRECT_POST_LOGIN_STEP,
  native: NATIVE_LOGIN_STEP,
};

/** Fluent builder for pipeline descriptors. */
class PipelineBuilder {
  private _options: ScraperOptions | false = false;

  private _hasBrowser = false;

  private _loginMode: LoginMode = 'none';

  private _loginConfig: ILoginConfig | false = false;

  private _loginFn: DirectPostLoginFn | NativeLoginFn | false = false;

  private _hasOtp = false;

  private _hasDashboard = false;

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
   * Use direct POST login (browser + API POST).
   * @param fn - Login function.
   * @returns This builder for chaining.
   */
  public withDirectPostLogin(fn: DirectPostLoginFn): this {
    this.assertNoLoginMode();
    this._loginMode = 'directPost';
    this._loginFn = fn;
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
    this._loginFn = fn;
    return this;
  }

  /**
   * Add OTP phase.
   * @param config - OTP configuration.
   * @returns This builder for chaining.
   */
  public withOtp(config: OtpConfig): this {
    this._hasOtp = true;
    this._loginConfig = this._loginConfig || (config as never);
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
    this._loginFn = this._loginFn || (fn as never);
    return this;
  }

  /**
   * Build the pipeline descriptor with ordered phases.
   * @returns The assembled pipeline descriptor.
   */
  public build(): IPipelineDescriptor {
    this.assertRequiredFields();
    const phases = this.assemblePhases();
    return { options: this._options as ScraperOptions, phases };
  }

  /**
   * Validate required fields are set.
   * @returns True if valid.
   * @throws If options or login mode missing.
   */
  private assertRequiredFields(): true {
    if (this._options === false) {
      throw new ScraperError('PipelineBuilder: withOptions() is required');
    }
    if (this._loginMode === 'none') {
      throw new ScraperError('PipelineBuilder: a login mode is required');
    }
    return true;
  }

  /**
   * Assemble ordered phases from configuration.
   * @returns Ordered array of phase definitions.
   */
  private assemblePhases(): CtxPhase[] {
    const phases: CtxPhase[] = [];
    this.addBrowserPhases(phases);
    this.addOptionalPhases(phases);
    return phases;
  }

  /**
   * Add browser init, login, and terminate phases.
   * @param phases - Mutable phase array to append to.
   * @returns The number of phases added.
   */
  private addBrowserPhases(phases: CtxPhase[]): number {
    if (this._hasBrowser) {
      const initPhase = actionOnly('init', INIT_STEP);
      phases.push(initPhase);
    }
    const loginStep = LOGIN_STEPS[this._loginMode];
    const loginPhase = actionOnly('login', loginStep);
    phases.push(loginPhase);
    if (this._hasBrowser) {
      const terminatePhase = actionOnly('scrape', TERMINATE_STEP);
      phases.push(terminatePhase);
    }
    return phases.length;
  }

  /**
   * Insert optional phases (otp, dashboard, scrape) before terminate.
   * @param phases - Mutable phase array to insert into.
   * @returns The number of optional phases added.
   */
  private addOptionalPhases(phases: CtxPhase[]): number {
    const insertIdx = this._hasBrowser ? phases.length - 1 : phases.length;
    const otpPhase = actionOnly('otp', OTP_STEP);
    const dashPhase = actionOnly('dashboard', DASHBOARD_STEP);
    const scrapePhase = actionOnly('scrape', SCRAPE_STEP);
    const optional: CtxPhase[] = [];
    if (this._hasOtp) optional.push(otpPhase);
    if (this._hasDashboard) optional.push(dashPhase);
    if (this._hasScraper) optional.push(scrapePhase);
    phases.splice(insertIdx, 0, ...optional);
    return optional.length;
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
}

export type { DirectPostLoginFn, NativeLoginFn, ScrapeFn };
export { PipelineBuilder };
