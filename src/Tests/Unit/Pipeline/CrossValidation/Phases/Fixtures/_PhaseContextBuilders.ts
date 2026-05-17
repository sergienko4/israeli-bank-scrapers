/**
 * Phase H.T4 — barrel re-export of every per-phase context builder
 * + their fixture loaders. Exists so {@link FullFlowFactory.test.ts}
 * can stay under the project's `import-x/max-dependencies` ceiling
 * (15 modules) while still chaining all 10 phase factories per row.
 *
 * <p>Single source of truth for the H.T3c.1..10 helpers used by the
 * full-flow chain. Each underlying helper file remains owned by its
 * per-phase factory; this barrel only re-exports symbols already
 * exported there.
 */

export { buildAccountResolvePhaseContext } from './_makeAccountResolvePhaseContext.js';
export { buildHomePhaseContext } from './_makeHomePhaseContext.js';
export { buildInitPhaseContext } from './_makeInitPhaseContext.js';
export {
  buildLoginPhaseContext,
  loadAuthDiscoveryFixtureCookies,
  loadLoginFixtureCookies,
} from './_makeLoginPhaseContext.js';
export { buildOtpFillPhaseContext } from './_makeOtpFillPhaseContext.js';
export { buildOtpTriggerPhaseContext } from './_makeOtpTriggerPhaseContext.js';
export { loadPhaseFixture, type PhaseHBank } from './_makePhaseFixture.js';
export { buildPreLoginPhaseContext } from './_makePreLoginPhaseContext.js';
export { buildScrapePhaseContext } from './_makeScrapePhaseContext.js';
export { buildTerminatePhaseContext } from './_makeTerminatePhaseContext.js';
