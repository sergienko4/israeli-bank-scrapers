/**
 * Common ↔ Pipeline UNIFY shim (Phase 3 — Commit 5 of 11).
 *
 * The canonical implementation moved to
 * `src/Scrapers/Pipeline/Mediator/Browser/SafeScreenshot.ts` as part
 * of the Phase-3 Probe 3.2 DoD=0 work (eliminating the only remaining
 * Pipeline → Common edge that was not already covered by the
 * CamoufoxLauncher flip slated for C8). This shim re-exports the
 * public surface so non-Pipeline callers (the legacy
 * `Scrapers/Base/BaseScraperWithBrowser.ts` plus the policy/contract
 * unit tests) keep compiling against `src/Common/SafeScreenshot.js`.
 *
 * Internal helpers from the previous Common implementation
 * (`isPreAuthScreenshot`, `scrubPaths`, `describeError`, `CaughtValue`)
 * are NOT re-exported — they returned bare primitives and would trip
 * Pipeline Rule #15 in the canonical home. The CI gating policy they
 * implemented is still exercised end-to-end via {@link safeScreenshot}.
 *
 * No brand-type wrappers are needed: every re-exported signature uses
 * plain types (`Promise<boolean>`, `ISafeScreenshotOptions`,
 * `readonly ['init', 'home']`). A direct `export … from` is sufficient.
 *
 * @deprecated Import from
 * `src/Scrapers/Pipeline/Mediator/Browser/SafeScreenshot.ts` directly.
 * This shim will be deleted when the last legacy caller migrates.
 */

export {
  type ISafeScreenshotOptions,
  PRE_AUTH_SCREENSHOT_PHASES,
  safeScreenshot,
} from '../Scrapers/Pipeline/Mediator/Browser/SafeScreenshot.js';
