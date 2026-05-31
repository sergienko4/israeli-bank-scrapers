/**
 * Pipeline builder setters — mutable state and login mode functions.
 * Extracted from PipelineBuilderHelpers.ts to respect max-lines.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import type { IApiDirectCallConfig } from '../../Mediator/ApiDirectCall/IApiDirectCallConfig.js';
import type { IApiDirectScrapeShape } from '../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { Brand } from '../../Types/Brand.js';
import type { LoginFn } from './PipelineAssembly.js';
import type { IBuilderFields, ScrapeFn } from './PipelineBuilderValidation.js';

/** Bank-supplied shape literal — variance erased at the builder boundary. */
type AnyApiDirectScrapeShape = IApiDirectScrapeShape<unknown, unknown>;

/** Setter outcome — true after applying state mutation. */
type DidSet = Brand<boolean, 'BuilderDidSet'>;

type LoginMode = 'none' | 'declarative' | 'apiDirectConfig';

/** Mutable builder state operated on by setter functions. */
interface IBuilderState {
  options: ScraperOptions | false;
  hasBrowser: boolean;
  isHeadless: boolean;
  loginMode: LoginMode;
  error: string;
  loginConfig: ILoginConfig | false;
  loginFn: LoginFn | false;
  hasPreLogin: boolean;
  hasOtpFill: boolean;
  otpFillRequired: boolean;
  hasOtpTrigger: boolean;
  scrapeFn: ScrapeFn | false;
  apiDirectScrape: AnyApiDirectScrapeShape | false;
  apiDirectConfig: IApiDirectCallConfig | false;
}

/** Default values for an empty builder state — split to keep the factory ≤ 15 LOC. */
const EMPTY_STATE_DEFAULTS: Omit<IBuilderState, 'options' | 'loginMode' | 'error'> = {
  hasBrowser: false,
  isHeadless: false,
  loginConfig: false,
  loginFn: false,
  hasPreLogin: false,
  hasOtpFill: false,
  otpFillRequired: true,
  hasOtpTrigger: false,
  scrapeFn: false,
  apiDirectScrape: false,
  apiDirectConfig: false,
};

/**
 * Create empty builder state.
 * @returns Fresh builder state.
 */
function createEmptyState(): IBuilderState {
  return { options: false, loginMode: 'none', error: '', ...EMPTY_STATE_DEFAULTS };
}

/**
 * Guard: no login mode set yet.
 * @param state - Mutable builder state.
 * @returns True if no conflict.
 */
function assertNoLoginMode(state: IBuilderState): DidSet {
  if (state.loginMode !== 'none') {
    state.error = 'PipelineBuilder: login mode already set';
    return false as DidSet;
  }
  return true as DidSet;
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
    return true as DidSet;
  }
  state.loginConfig = configOrFn;
  return true as DidSet;
}

/**
 * Set the API-DIRECT-CALL config literal on builder state. Banks
 * declare their login as data via withApiDirect; this setter
 * is the only path into api-direct-call mode after the plugin port
 * was deleted (Phase 3D).
 * @param state - Mutable builder state.
 * @param config - Bank IApiDirectCallConfig literal.
 * @returns True after setting.
 */
function setApiDirectConfig(state: IBuilderState, config: IApiDirectCallConfig): DidSet {
  assertNoLoginMode(state);
  state.loginMode = 'apiDirectConfig';
  state.apiDirectConfig = config;
  return true as DidSet;
}

/**
 * Set the API-DIRECT-SCRAPE shape literal on builder state. Banks
 * supply pure data (customer + balance + transactions step shapes);
 * the new ApiDirectScrape phase consumes the literal at runtime.
 * Replaces the legacy `withScraper(fn)` path for API-direct banks.
 * @param state - Mutable builder state.
 * @param shape - Bank IApiDirectScrapeShape literal.
 * @returns True after setting.
 */
function setApiDirectScrape(state: IBuilderState, shape: AnyApiDirectScrapeShape): DidSet {
  state.apiDirectScrape = shape;
  return true as DidSet;
}

/**
 * Snapshot mutable state to IBuilderFields.
 * @param state - Mutable builder state.
 * @returns Immutable fields snapshot.
 */
function snapshotFields(state: IBuilderState): IBuilderFields {
  return { ...state };
}

export type { AnyApiDirectScrapeShape, IBuilderState };
export {
  createEmptyState,
  setApiDirectConfig,
  setApiDirectScrape,
  setDeclarativeLogin,
  snapshotFields,
};
