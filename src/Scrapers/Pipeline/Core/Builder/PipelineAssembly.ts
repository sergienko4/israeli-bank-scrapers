/**
 * Pipeline assembly — declarative phase chain composition.
 *
 * <p>Single source of truth for the order of pipeline phases. Every
 * registered bank is API-direct, so the chain is LOGIN
 * ({@link createApiDirectCallPhase}) followed by SCRAPE
 * ({@link buildApiDirectScrapePhase}). Each slot yields its phase, or `false`
 * when the builder state did not configure it; {@link assemblePhases} walks the
 * chain once and keeps the phases that exist.
 *
 * <p>Phases communicate only via the slim value-typed `Option<...>` fields on
 * `IPipelineContext` — no cross-phase backdoors.
 */

import type { IApiDirectCallConfig } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { createApiDirectCallPhase } from '../../Phases/ApiDirectCall/ApiDirectCallPhase.js';
import { buildApiDirectScrapePhase } from '../../Phases/ApiDirectScrape/ApiDirectScrapePhase.js';
import type { IApiDirectScrapeShape } from '../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { BasePhase } from '../../Phases/Base/BasePhase.js';

/** Bundled builder state for assembly. */
interface IBuilderState {
  readonly apiDirectScrape: IApiDirectScrapeShape<unknown, unknown> | false;
  readonly apiDirectConfig: IApiDirectCallConfig | false;
}

/** One slot of the phase chain — its phase, or `false` when not configured. */
type PhaseSlot = (state: IBuilderState) => BasePhase | false;

/**
 * Build the LOGIN phase from the bank's api-direct call config.
 * @param state - Builder state.
 * @returns API-DIRECT-CALL phase, or false without a call config.
 */
function makeLogin(state: IBuilderState): BasePhase | false {
  if (state.apiDirectConfig === false) return false;
  return createApiDirectCallPhase(state.apiDirectConfig);
}

/**
 * Build the SCRAPE phase from the bank's api-direct scrape shape.
 * @param state - Builder state.
 * @returns API-DIRECT-SCRAPE phase, or false without a shape.
 */
function makeScrape(state: IBuilderState): BasePhase | false {
  if (state.apiDirectScrape === false) return false;
  return buildApiDirectScrapePhase(state.apiDirectScrape);
}

/** The phase chain — LOGIN then SCRAPE. Order matters. */
const PHASE_CHAIN: readonly PhaseSlot[] = [makeLogin, makeScrape];

/**
 * Assemble the ordered phase list from the validated builder state.
 * @param state - Builder state.
 * @returns Ordered phase array.
 */
function assemblePhases(state: IBuilderState): BasePhase[] {
  const slots = PHASE_CHAIN.map((slot): BasePhase | false => slot(state));
  return slots.filter((phase): phase is BasePhase => phase !== false);
}

export type { IBuilderState };
export { assemblePhases };
