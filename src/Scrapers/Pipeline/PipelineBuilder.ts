/**
 * Pipeline builder — fluent builder that constructs IPipelineDescriptor.
 * Banks declare their pipeline via this builder.
 * build() assembles IPhaseDefinitions in order: init → login → otp → dashboard → scrape.
 */

import type { OtpConfig } from '../Base/Config/LoginConfigTypes.js';
import { ScraperErrorTypes } from '../Base/ErrorTypes.js';
import type { ScraperOptions } from '../Base/Interface.js';
import type { ILoginConfig } from '../Base/Interfaces/Config/LoginConfig.js';
import { DASHBOARD_STEP } from './Phases/DashboardPhase.js';
import { createLoginStep, DECLARATIVE_LOGIN_STEP } from './Phases/DeclarativeLoginPhase.js';
import { DIRECT_POST_LOGIN_STEP } from './Phases/DirectPostLoginPhase.js';
import { INIT_STEP } from './Phases/InitPhase.js';
import { createLoginPhase } from './Phases/LoginSteps.js';
import { NATIVE_LOGIN_STEP } from './Phases/NativeLoginPhase.js';
import { OTP_STEP } from './Phases/OtpPhase.js';
import {
  createConfigScrapeStep,
  createCustomScrapeStep,
  SCRAPE_STEP,
} from './Phases/ScrapePhase.js';
import { TERMINATE_STEP } from './Phases/TerminatePhase.js';
import type { IPipelineDescriptor } from './PipelineDescriptor.js';
import { none, some } from './Types/Option.js';
import type { IPhaseDefinition, PhaseName } from './Types/Phase.js';
import type { IPipelineContext } from './Types/PipelineContext.js';
import type { Procedure } from './Types/Procedure.js';
import { fail, succeed } from './Types/Procedure.js';
import type { IScrapeConfig, IScrapeConfigBase } from './Types/ScrapeConfig.js';

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
 * Adapt a 2-param login fn (ctx, creds) to a 1-param LoginFn (ctx).
 * @param fn - Bank-provided login function.
 * @returns Adapted function for createLoginStep.
 */
function adaptLoginFn(
  fn: DirectPostLoginFn | NativeLoginFn,
): (ctx: IPipelineContext) => Promise<Procedure<IPipelineContext>> {
  return (ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> => {
    const creds = ctx.credentials as Record<string, string>;
    return fn(ctx, creds);
  };
}

/**
 * Build a declarative login phase from ILoginConfig.
 * @param config - Bank's login config.
 * @returns Full phase definition with pre/action/post.
 */
function buildDeclarativePhase(config: ILoginConfig): CtxPhase {
  const phase = createLoginPhase(config);
  const result: CtxPhase = {
    name: 'login',
    pre: some(phase.pre),
    action: phase.action,
    post: some(phase.post),
  };
  return result;
}

/**
 * Create a phase with only an action step (no pre/post).
 * @param name - The phase name.
 * @param action - The action step.
 * @returns A phase definition with pre and post set to none().
 */
function actionOnly(name: PhaseName, action: CtxPhase['action']): CtxPhase {
  const phase: CtxPhase = { name, pre: none(), action, post: none() };
  return phase;
}

/** Login step lookup map for non-ILoginConfig login modes. */
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

  private _error = '';

  private _loginConfig: ILoginConfig | false = false;

  private _loginFn: DirectPostLoginFn | NativeLoginFn | false = false;

  private _otpConfig: OtpConfig | false = false;

  private _hasOtp = false;

  private _hasDashboard = false;

  private _scrapeFn: ScrapeFn | false = false;

  private _scrapeConfig: IScrapeConfigBase | false = false;

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
   * Use declarative form-based login.
   * Accepts either a login function or an ILoginConfig (for backward compat).
   * @param configOrFn - Bank's login function or ILoginConfig.
   * @returns This builder for chaining.
   */
  public withDeclarativeLogin(configOrFn: ILoginConfig | DirectPostLoginFn): this {
    this.assertNoLoginMode();
    this._loginMode = 'declarative';
    if (typeof configOrFn === 'function') {
      this._loginFn = configOrFn;
      return this;
    }
    this._loginConfig = configOrFn;
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
    // FUTURE: wire _otpConfig to createOtpStep when real OTP is implemented
    this._otpConfig = config;
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
    this._scrapeFn = fn;
    return this;
  }

  /**
   * Set generic scrape config (URLs + mappers, pipeline handles fetch).
   * @param config - The bank's IScrapeConfig.
   * @returns This builder for chaining.
   */
  public withScrapeConfig<TA extends object, TT extends object>(
    config: IScrapeConfig<TA, TT>,
  ): this {
    this._hasScraper = true;
    this._scrapeConfig = config as IScrapeConfigBase;
    return this;
  }

  /**
   * Build the pipeline descriptor with ordered phases.
   * @returns The assembled pipeline descriptor.
   */
  public build(): Procedure<IPipelineDescriptor> {
    const validation = this.assertRequiredFields();
    if (!validation.success) return validation;
    const phases = this.assemblePhases();
    const descriptor: IPipelineDescriptor = {
      options: this._options as ScraperOptions,
      phases,
    };
    return succeed(descriptor);
  }

  /**
   * Validate required fields are set.
   * @returns Success if valid, failure with error message.
   */
  private assertRequiredFields(): Procedure<true> {
    const checks: readonly [boolean, string][] = [
      [!!this._error, this._error || ''],
      [this._options === false, 'PipelineBuilder: withOptions() is required'],
      [this._loginMode === 'none', 'PipelineBuilder: a login mode is required'],
    ];
    const failed = checks.find(([isErr]): boolean => isErr);
    if (failed) return fail(ScraperErrorTypes.Generic, failed[1]);
    return succeed(true);
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
   * Resolve the login step — uses stored fn if available, else static stub.
   * @returns The login pipeline step.
   */
  private resolveLoginStep(): CtxPhase['action'] {
    if (this._loginFn) {
      const adapted = adaptLoginFn(this._loginFn);
      return createLoginStep(adapted);
    }
    if (this._otpConfig) return DECLARATIVE_LOGIN_STEP;
    return LOGIN_STEPS[this._loginMode];
  }

  /**
   * Resolve the scrape step — uses stored fn if available, else static stub.
   * @returns The scrape pipeline step.
   */
  private resolveScrapeStep(): CtxPhase['action'] {
    if (this._scrapeConfig) return createConfigScrapeStep(this._scrapeConfig);
    if (this._scrapeFn) return createCustomScrapeStep(this._scrapeFn);
    return SCRAPE_STEP;
  }

  /**
   * Build the login phase with pre/action/post when config available.
   * @returns Full phase definition for login.
   */
  private buildLoginPhase(): CtxPhase {
    if (this._loginConfig) return buildDeclarativePhase(this._loginConfig);
    const loginStep = this.resolveLoginStep();
    return actionOnly('login', loginStep);
  }

  /**
   * Add browser init, login, and terminate phases.
   * @param phases - Mutable phase array to append to.
   * @returns The number of phases added.
   */
  private addBrowserPhases(phases: CtxPhase[]): void {
    if (this._hasBrowser) {
      const initPhase = actionOnly('init', INIT_STEP);
      phases.push(initPhase);
    }
    const loginPhase = this.buildLoginPhase();
    phases.push(loginPhase);
    if (this._hasBrowser) {
      const terminatePhase = actionOnly('terminate', TERMINATE_STEP);
      phases.push(terminatePhase);
    }
  }

  /**
   * Insert optional phases (otp, dashboard, scrape) before terminate.
   * @param phases - Mutable phase array to insert into.
   */
  private addOptionalPhases(phases: CtxPhase[]): void {
    const insertIdx = phases.length - Number(this._hasBrowser);
    const otpPhase = actionOnly('otp', OTP_STEP);
    const dashPhase = actionOnly('dashboard', DASHBOARD_STEP);
    const scrapeStep = this.resolveScrapeStep();
    const scrapePhase = actionOnly('scrape', scrapeStep);
    const optional: CtxPhase[] = [];
    if (this._hasOtp) optional.push(otpPhase);
    if (this._hasDashboard) optional.push(dashPhase);
    if (this._hasScraper) optional.push(scrapePhase);
    phases.splice(insertIdx, 0, ...optional);
  }

  /**
   * Assert no login mode has been set yet.
   * @returns Success if no login mode set, failure otherwise.
   */
  private assertNoLoginMode(): void {
    if (this._loginMode !== 'none') {
      this._error = 'PipelineBuilder: login mode already set';
    }
  }
}

/**
 * Factory: create a new PipelineBuilder instance.
 * @returns Fresh PipelineBuilder ready for fluent configuration.
 */
function createPipelineBuilder(): PipelineBuilder {
  return new PipelineBuilder();
}

export type { DirectPostLoginFn, NativeLoginFn, ScrapeFn };
export { createPipelineBuilder, PipelineBuilder };
