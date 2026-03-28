/**
 * Pipeline builder — fluent builder that constructs IPipelineDescriptor.
 * Banks declare their pipeline via this builder.
 * build() assembles BasePhase instances: init → home → FLA → login → ... → terminate.
 */

import type { OtpConfig } from '../Base/Config/LoginConfigTypes.js';
import { ScraperErrorTypes } from '../Base/ErrorTypes.js';
import type { ScraperOptions } from '../Base/Interface.js';
import type { ILoginConfig } from '../Base/Interfaces/Config/LoginConfig.js';
import { createDashboardPhase } from './Phases/DashboardPhase.js';
import { DECLARATIVE_LOGIN_STEP } from './Phases/DeclarativeLoginPhase.js';
import { DIRECT_POST_LOGIN_STEP } from './Phases/DirectPostLoginPhase.js';
import { createFindLoginAreaPhase } from './Phases/FindLoginAreaPhase.js';
import { createHomePhase } from './Phases/HomePhase.js';
import { INIT_STEP } from './Phases/InitPhase.js';
import { createLoginPhase } from './Phases/LoginSteps.js';
import { NATIVE_LOGIN_STEP } from './Phases/NativeLoginPhase.js';
import { OTP_STEP } from './Phases/OtpPhase.js';
import {
  createConfigScrapeStep,
  createCustomScrapeStep,
  createScrapePhase,
  SCRAPE_STEP,
} from './Phases/ScrapePhase.js';
import { TERMINATE_STEP } from './Phases/TerminatePhase.js';
import type { IPipelineDescriptor } from './PipelineDescriptor.js';
import type { BasePhase } from './Types/BasePhase.js';
import { SimplePhase } from './Types/BasePhase.js';
import type { IPipelineStep } from './Types/Phase.js';
import type { IPipelineContext } from './Types/PipelineContext.js';
import type { Procedure } from './Types/Procedure.js';
import { fail, succeed } from './Types/Procedure.js';
import type { IScrapeConfig, IScrapeConfigBase } from './Types/ScrapeConfig.js';

/** Whether a validation check found an error condition. */
type IsErrCheck = boolean;
/** Number of phases added or inserted in a builder step. */
type PhaseCount = number;
/** Whether a login mode assertion passed without conflict. */
type AssertResult = boolean;

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

/** Step execute function type alias. */
type StepExecFn = IPipelineStep<IPipelineContext, IPipelineContext>['execute'];

/**
 * Adapt a 2-param login fn (ctx, creds) to a StepExecFn.
 * @param fn - Bank-provided login function.
 * @returns Adapted function for SimplePhase.
 */
function adaptLoginFn(fn: DirectPostLoginFn | NativeLoginFn): StepExecFn {
  return (ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> => {
    const creds = ctx.credentials as Record<string, string>;
    return fn(ctx, creds);
  };
}

/**
 * Build a declarative login phase from ILoginConfig using BasePhase classes.
 * @param config - Bank's login config.
 * @returns A LoginPhaseClass that extends BasePhase with pre/action/post from LoginSteps.
 */
function buildDeclarativePhase(config: ILoginConfig): BasePhase {
  const phase = createLoginPhase(config);
  /** Declarative login phase — wraps LoginSteps pre/action/post into BasePhase. */
  class DeclarativeLogin extends SimplePhase {
    /**
     * PreLogin: checkReadiness + preAction.
     * @param ctx - Pipeline context.
     * @param input - Pipeline context.
     * @returns Updated context with login.activeFrame.
     */
    async pre(
      ctx: IPipelineContext,
      input: IPipelineContext,
    ): Promise<Procedure<IPipelineContext>> {
      return phase.pre.execute(ctx, input);
    }

    /**
     * PostLogin: wait + error check + postAction.
     * @param ctx - Pipeline context.
     * @param input - Pipeline context.
     * @returns Success or login error.
     */
    async post(
      ctx: IPipelineContext,
      input: IPipelineContext,
    ): Promise<Procedure<IPipelineContext>> {
      return phase.post.execute(ctx, input);
    }
  }
  return new DeclarativeLogin('login', phase.action.execute);
}

/** Login step lookup map for non-ILoginConfig login modes. */
const LOGIN_STEPS: Record<string, StepExecFn> = {
  declarative: DECLARATIVE_LOGIN_STEP.execute,
  directPost: DIRECT_POST_LOGIN_STEP.execute,
  native: NATIVE_LOGIN_STEP.execute,
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

  private _scrapeFn: ScrapeFn | false = false;

  private _scrapeConfig: IScrapeConfigBase | false = false;

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
    this._otpConfig = config;
    return this;
  }

  /**
   * Set transaction scraping function.
   * @param fn - Bank-specific scrape function.
   * @returns This builder for chaining.
   */
  public withScraper(fn: ScrapeFn): this {
    this._scrapeFn = fn;
    return this;
  }

  /**
   * Set generic scrape config (URLs + mappers).
   * @param config - The bank's IScrapeConfig.
   * @returns This builder for chaining.
   */
  public withScrapeConfig<TA extends object, TT extends object>(
    config: IScrapeConfig<TA, TT>,
  ): this {
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
    const failed = checks.find(([isErr]): IsErrCheck => isErr);
    if (failed) return fail(ScraperErrorTypes.Generic, failed[1]);
    return succeed(true);
  }

  /**
   * Assemble ordered phases from configuration.
   * @returns Ordered array of BasePhase instances.
   */
  private assemblePhases(): BasePhase[] {
    const phases: BasePhase[] = [];
    this.addBrowserPhases(phases);
    this.addOptionalPhases(phases);
    return phases;
  }

  /**
   * Resolve the login step execute function.
   * @returns The login execute function.
   */
  private resolveLoginExec(): StepExecFn {
    if (this._loginFn) return adaptLoginFn(this._loginFn);
    if (this._otpConfig) return DECLARATIVE_LOGIN_STEP.execute;
    return LOGIN_STEPS[this._loginMode];
  }

  /**
   * Resolve the scrape step execute function.
   * @returns The scrape execute function.
   */
  private resolveScrapeExec(): StepExecFn {
    if (this._scrapeConfig) return createConfigScrapeStep(this._scrapeConfig).execute;
    if (this._scrapeFn) return createCustomScrapeStep(this._scrapeFn).execute;
    return SCRAPE_STEP.execute;
  }

  /**
   * Build the login phase — full BasePhase with pre/action/post when config available.
   * @returns BasePhase for login.
   */
  private buildLoginPhase(): BasePhase {
    if (this._loginConfig) return buildDeclarativePhase(this._loginConfig);
    const loginExec = this.resolveLoginExec();
    return new SimplePhase('login', loginExec);
  }

  /**
   * Add browser init, login, and terminate phases.
   * @param phases - Mutable phase array to append to.
   * @returns The number of phases added.
   */
  private addBrowserPhases(phases: BasePhase[]): PhaseCount {
    const before = phases.length;
    if (this._hasBrowser) {
      phases.push(new SimplePhase('init', INIT_STEP.execute));
      phases.push(createHomePhase());
      phases.push(createFindLoginAreaPhase());
    }
    phases.push(this.buildLoginPhase());
    if (this._hasBrowser) {
      phases.push(new SimplePhase('terminate', TERMINATE_STEP.execute));
    }
    return phases.length - before;
  }

  /**
   * Insert optional phases before terminate.
   * @param phases - Mutable phase array to insert into.
   * @returns The number of optional phases inserted.
   */
  private addOptionalPhases(phases: BasePhase[]): PhaseCount {
    const insertIdx = phases.length - Number(this._hasBrowser);
    const optional: BasePhase[] = [];
    if (this._hasOtp) optional.push(new SimplePhase('otp', OTP_STEP.execute));
    if (this._hasBrowser) optional.push(createDashboardPhase());
    const hasScraper = this._scrapeFn || this._scrapeConfig || this._hasBrowser;
    if (hasScraper) {
      const scrapeExec = this.resolveScrapeExec();
      optional.push(createScrapePhase(scrapeExec));
    }
    phases.splice(insertIdx, 0, ...optional);
    return optional.length;
  }

  /**
   * Assert no login mode has been set yet.
   * @returns True if no login mode set.
   */
  private assertNoLoginMode(): AssertResult {
    if (this._loginMode !== 'none') {
      this._error = 'PipelineBuilder: login mode already set';
      return false;
    }
    return true;
  }
}

/**
 * Factory: create a new PipelineBuilder instance.
 * @returns Fresh PipelineBuilder.
 */
function createPipelineBuilder(): PipelineBuilder {
  return new PipelineBuilder();
}

export type { DirectPostLoginFn, NativeLoginFn, ScrapeFn };
export { createPipelineBuilder, PipelineBuilder };
