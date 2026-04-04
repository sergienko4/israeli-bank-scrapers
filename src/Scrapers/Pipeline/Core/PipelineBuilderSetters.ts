/**
 * Pipeline builder setters — mutable state and login mode functions.
 * Extracted from PipelineBuilderHelpers.ts to respect max-lines.
 */

import type { OtpConfig } from '../../Base/Config/LoginConfigTypes.js';
import type { ScraperOptions } from '../../Base/Interface.js';
import type { ILoginConfig } from '../../Base/Interfaces/Config/LoginConfig.js';
import type { IProxyAuth } from '../Registry/Config/PipelineBankConfig.js';
import type { IScrapeConfig, IScrapeConfigBase } from '../Types/ScrapeConfig.js';
import type { LoginFn } from './BuilderAssembly.js';
import type { IBuilderFields, ScrapeFn } from './PipelineBuilderValidation.js';

type LoginMode = 'none' | 'declarative' | 'directPost' | 'native';
/** Whether a builder capability flag is set. */
type HasCapability = boolean;
/** Whether a builder setter completed without conflict. */
type DidSet = boolean;
/** Builder error message (empty when no error). */
type BuilderError = string;

/** Mutable builder state operated on by setter functions. */
interface IBuilderState {
  options: ScraperOptions | false;
  hasBrowser: HasCapability;
  loginMode: LoginMode;
  error: BuilderError;
  loginConfig: ILoginConfig | false;
  loginFn: LoginFn | false;
  otpConfig: OtpConfig | false;
  hasOtp: HasCapability;
  scrapeFn: ScrapeFn | false;
  scrapeConfig: IScrapeConfigBase | false;
  proxyAuth: IProxyAuth | false;
}

/**
 * Create empty builder state.
 * @returns Fresh builder state.
 */
function createEmptyState(): IBuilderState {
  return {
    options: false,
    hasBrowser: false,
    loginMode: 'none',
    error: '',
    loginConfig: false,
    loginFn: false,
    otpConfig: false,
    hasOtp: false,
    scrapeFn: false,
    scrapeConfig: false,
    proxyAuth: false,
  };
}

/**
 * Guard: no login mode set yet.
 * @param state - Mutable builder state.
 * @returns True if no conflict.
 */
function assertNoLoginMode(state: IBuilderState): DidSet {
  if (state.loginMode !== 'none') {
    state.error = 'PipelineBuilder: login mode already set';
    return false;
  }
  return true;
}

/**
 * Set declarative login mode from config or function.
 * @param state - Mutable builder state.
 * @param configOrFn - ILoginConfig or login function.
 * @returns True after setting.
 */
function setDeclarativeLogin(state: IBuilderState, configOrFn: ILoginConfig | LoginFn): DidSet {
  assertNoLoginMode(state);
  state.loginMode = 'declarative';
  if (typeof configOrFn === 'function') {
    state.loginFn = configOrFn;
    return true;
  }
  state.loginConfig = configOrFn;
  return true;
}

/**
 * Set function-based login mode.
 * @param state - Mutable builder state.
 * @param mode - Login mode name.
 * @param fn - Login function.
 * @returns True after setting.
 */
function setFnLogin(state: IBuilderState, mode: LoginMode, fn: LoginFn): DidSet {
  assertNoLoginMode(state);
  state.loginMode = mode;
  state.loginFn = fn;
  return true;
}

/**
 * Set scrape config on builder state.
 * @param state - Mutable builder state.
 * @param config - Bank scrape config.
 * @returns True after setting.
 */
function setScrapeConfig<TA extends object, TT extends object>(
  state: IBuilderState,
  config: IScrapeConfig<TA, TT>,
): DidSet {
  state.scrapeConfig = config as IScrapeConfigBase;
  return true;
}

/**
 * Snapshot mutable state to IBuilderFields.
 * @param state - Mutable builder state.
 * @returns Immutable fields snapshot.
 */
function snapshotFields(state: IBuilderState): IBuilderFields {
  return {
    options: state.options,
    hasBrowser: state.hasBrowser,
    loginMode: state.loginMode,
    error: state.error,
    loginConfig: state.loginConfig,
    loginFn: state.loginFn,
    otpConfig: state.otpConfig,
    hasOtp: state.hasOtp,
    scrapeFn: state.scrapeFn,
    scrapeConfig: state.scrapeConfig,
    proxyAuth: state.proxyAuth,
  };
}

export type { IBuilderState };
export { createEmptyState, setDeclarativeLogin, setFnLogin, setScrapeConfig, snapshotFields };
