/**
 * Common-side shim — re-exports the canonical Camoufox launcher
 * from `src/Scrapers/Pipeline/Mediator/Browser/CamoufoxLauncher.ts`.
 *
 * <p>Background: the Camoufox launcher used to live here as the
 * canonical source while a 14-line shim sat in Pipeline. Phase 3 C8
 * (Common ↔ Pipeline unification) flipped the relationship so
 * Pipeline owns the impl (single source of truth, single Rule #15
 * scope) and Common keeps a back-compat shim for the existing
 * import sites (`src/Scrapers/Base/BaseScraperWithBrowser.ts` plus
 * the E2E-mocked + drift-canary tests).
 *
 * <p>All four public symbols (`ISRAEL_LOCALE`, `launchCamoufox`,
 * `buildLaunchOptions`, `envFlag`) round-trip unchanged so neither
 * production callers nor the
 * `Tests/Unit/Common/CamoufoxLauncherKnobs.test.ts` drift canary
 * need an import-path edit.
 */
export type { EnvFlag } from '../Scrapers/Pipeline/Mediator/Browser/CamoufoxLauncher.js';
export {
  buildLaunchOptions,
  envFlag,
  ISRAEL_LOCALE,
  launchCamoufox,
} from '../Scrapers/Pipeline/Mediator/Browser/CamoufoxLauncher.js';
