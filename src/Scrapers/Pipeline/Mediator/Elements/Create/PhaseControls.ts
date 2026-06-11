/**
 * PhaseControls cluster — phase / stage state hooks plus the small
 * `discoverErrors` + `waitForLoadingDone` surfaces. Owns the
 * `ActiveState` module pass-through outright (Phase 12a §6 plan note:
 * the transient re-export in `Create/index.ts` is gone now that
 * the façade no longer pulls these symbols directly).
 *
 * Re-exports `getActivePhase` / `getActiveStage` so the façade can
 * surface them publicly without a second source-of-truth import.
 *
 * Also exposes `buildStaticCluster` — the cohesive "page-independent
 * methods" aggregator that fuses PhaseControls with the AttrBundle so
 * `assembleElementMediator` spreads 6 sources instead of 7 (keeps the
 * aggregator body ≤ 10 LoC).
 */

import {
  getActivePhase,
  getActiveStage,
  setActivePhase as setGlobalPhase,
  setActiveStage as setGlobalStage,
} from '../../../Types/ActiveState.js';
import { type IElementMediator } from '../ElementMediator.js';
import { buildDiscoverErrors } from './Discover.js';
import { type AttrBundle, buildAttrCluster } from './Observation.js';
import { buildWaitForLoadingDone } from './Wait.js';

export { getActivePhase, getActiveStage };

/** Phase / stage / discovery primitives — page-independent state hooks. */
export type PhaseControlsBundle = Pick<
  IElementMediator,
  'setActivePhase' | 'setActiveStage' | 'discoverErrors' | 'waitForLoadingDone'
>;

/** Stateless surfaces merged — keeps the aggregator's spread count ≤ 6. */
export type StaticBundle = PhaseControlsBundle & AttrBundle;

/**
 * Build the 4-method phase / stage / discovery cluster. Page-independent
 * (state hooks delegate to ActiveState module singletons).
 * @returns Phase-control method bundle.
 */
export function buildPhaseControls(): PhaseControlsBundle {
  return {
    setActivePhase: setGlobalPhase,
    setActiveStage: setGlobalStage,
    discoverErrors: buildDiscoverErrors(),
    waitForLoadingDone: buildWaitForLoadingDone(),
  };
}

/**
 * Merge the two stateless clusters (phase controls + attribute reads)
 * into one bundle. Lets `assembleElementMediator` spread 6 sources
 * instead of 7 so the aggregator body stays ≤ 10 LoC.
 * @returns Static (page-independent) method bundle.
 */
export function buildStaticCluster(): StaticBundle {
  return { ...buildPhaseControls(), ...buildAttrCluster() };
}
