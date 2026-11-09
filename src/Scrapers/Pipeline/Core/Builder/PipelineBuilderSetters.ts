/**
 * Pipeline builder setters — mutable state and login mode functions.
 * Extracted from PipelineBuilderHelpers.ts to respect max-lines.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import type { IApiDirectCallConfig } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { IApiDirectScrapeShape } from '../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { Brand } from '../../Types/Brand.js';
import type { IBuilderFields } from './PipelineBuilderValidation.js';

/** Bank-supplied shape literal — variance erased at the builder boundary. */
type AnyApiDirectScrapeShape = IApiDirectScrapeShape<unknown, unknown>;

/** Setter outcome — true after applying state mutation. */
type DidSet = Brand<boolean, 'BuilderDidSet'>;

type LoginMode = 'none' | 'apiDirectConfig';

/** Mutable builder state operated on by setter functions. */
interface IBuilderState {
  options: ScraperOptions | false;
  isHeadless: boolean;
  loginMode: LoginMode;
  error: string;
  apiDirectScrape: AnyApiDirectScrapeShape | false;
  apiDirectConfig: IApiDirectCallConfig | false;
}

/** Default values for an empty builder state — split to keep the factory ≤ 15 LOC. */
const EMPTY_STATE_DEFAULTS: Omit<IBuilderState, 'options' | 'loginMode' | 'error'> = {
  isHeadless: false,
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
 * the ApiDirectScrape phase consumes the literal at runtime.
 * @param state - Mutable builder state.
 * @param shape - Bank IApiDirectScrapeShape literal.
 * @returns True after setting.
 */
function setApiDirectScrape(state: IBuilderState, shape: AnyApiDirectScrapeShape): DidSet {
  state.apiDirectScrape = shape;
  return true as DidSet;
}

/**
 * Carry the login config's `omitBankText` onto the scrape shape, so a bank
 * that keeps its own text out of login failures keeps it out of scrape
 * failures too.
 * @param shape - Bank IApiDirectScrapeShape literal.
 * @param config - The same bank's IApiDirectCallConfig literal.
 * @returns The shape, flagged when the login config sets `omitBankText`.
 */
function bindBankTextRule(
  shape: AnyApiDirectScrapeShape,
  config: IApiDirectCallConfig,
): AnyApiDirectScrapeShape {
  if (config.omitBankText !== true) return shape;
  return { ...shape, omitBankText: true };
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
  bindBankTextRule,
  createEmptyState,
  setApiDirectConfig,
  setApiDirectScrape,
  snapshotFields,
};
