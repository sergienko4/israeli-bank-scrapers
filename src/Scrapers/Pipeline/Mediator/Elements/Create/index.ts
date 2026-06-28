/**
 * Barrel for Create/* sub-modules — single import source for the
 * CreateElementMediator façade. Prevents the per-file max-dependencies
 * cap from blowing up as more clusters are extracted in Phase 12a.
 *
 * Re-exports are explicit (not `*`) so dead-code / unused-import gates
 * can still see each symbol and tree-shaking remains accurate.
 *
 * NOTE — ActiveState pass-through is now owned by PhaseControls.ts
 * (Phase 12a Commit 6 trim). The façade pulls `getActivePhase` /
 * `getActiveStage` via this barrel which re-exports them from
 * PhaseControls; `setActivePhase` / `setActiveStage` are consumed
 * internally by PhaseControls and no longer surface through the barrel.
 */

export { extractActionMediator } from './ActionMediator.js';
export { assembleElementMediator } from './Assembly.js';
export { buildCookieCluster, type CookieBundle } from './Cookies.js';
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
export { buildNavCluster, type NavBundle } from './Navigation.js';
export {
  type AttrBundle,
  buildAttrCluster,
  buildCountCluster,
  type CountBundle,
} from './Observation.js';
export {
  buildPhaseControls,
  buildStaticCluster,
  getActivePhase,
  getActiveStage,
  type PhaseControlsBundle,
  type StaticBundle,
} from './PhaseControls.js';
export {
  enrichWinnerToResult,
  extractWinnerSequence,
  type IRaceSetup,
  raceEntriesToResult,
  setupAllVisibleRace,
  traceRaceDiagnostic,
} from './Race.js';
export {
  buildFormCluster,
  buildResolveCluster,
  type FormBundle,
  type ResolveBundle,
} from './Resolve.js';
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
export { buildIsLoadingVisible, buildWaitForLoadingDone } from './Wait.js';
