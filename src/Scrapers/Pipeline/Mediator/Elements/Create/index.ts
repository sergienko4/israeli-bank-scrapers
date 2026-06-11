/**
 * Barrel for Create/* sub-modules — single import source for the
 * CreateElementMediator façade. Prevents the per-file max-dependencies
 * cap from blowing up as more clusters are extracted in Phase 12a.
 *
 * Re-exports are explicit (not `*`) so dead-code / unused-import gates
 * can still see each symbol and tree-shaking remains accurate.
 *
 * NOTE — ActiveState pass-through: `setActivePhase`/`setActiveStage` and
 * `getActivePhase`/`getActiveStage` are re-exported from this barrel
 * (rather than imported directly by the façade) purely to keep the
 * façade under the 15-dependency cap mid-refactor. The PhaseControls
 * cluster (Commit 6) will own them outright and the pass-through will
 * disappear when the façade trims to ≤150 LoC.
 */

export {
  getActivePhase,
  getActiveStage,
  setActivePhase,
  setActiveStage,
} from '../../../Types/ActiveState.js';
export { buildDiscoverErrors, buildDiscoverForm, buildScopeToForm } from './Discover.js';
export { buildLocatorEntries, buildLocatorEntriesAll, type ILocatorEntry } from './Entries.js';
export { buildResolveClickable, buildResolveField, type IFormCache } from './FieldResolve.js';
export { type IRaceDiagnostic, raceLocators, raceLocatorsWithHitTest } from './Hittest.js';
export {
  buildAriaLabelLocators,
  buildCandidateLocators,
  buildCandidateLocatorsBase,
  buildClickableTextLocatorsBase,
  buildCssLocators,
  buildExactTextLocators,
  buildLabelTextLocators,
  buildNameLocators,
  buildPlaceholderLocators,
  buildRegexLocators,
  buildWalkUpLocatorsBase,
  buildXpathLocators,
  LOCATOR_KIND_BUILDERS,
  type LocatorKindBuilder,
} from './Locators.js';
export {
  enrichWinnerToResult,
  extractWinnerSequence,
  type IRaceSetup,
  raceEntriesToResult,
  setupAllVisibleRace,
  traceRaceDiagnostic,
} from './Race.js';
export {
  applyFormScope,
  CLICK_RACE_TIMEOUT,
  type LocatorContext,
  NO_FORM_ANCHOR,
} from './Scope.js';
export {
  buildFoundResult,
  extractAndTraceIdentity,
  type IWinnerInfo,
  snapshotValue,
} from './Snapshot.js';
export { buildWaitForLoadingDone } from './Wait.js';
