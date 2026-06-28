/**
 * Common-side shim — re-exports the canonical wait/timing helpers
 * from `src/Scrapers/Pipeline/Mediator/Timing/Waiting.ts`.
 *
 * @deprecated since v8.5 — delete in v8.6. Use the canonical Pipeline
 *   path `src/Scrapers/Pipeline/Mediator/Timing/Waiting.ts` directly.
 *
 * <p>Background: Common used to ship its own 242-LoC implementation
 * of `waitUntil` / `raceTimeout` / `runSerial` / `sleep` / `humanDelay`
 * + `TimeoutError` class, while Pipeline already owned a more
 * carefully-decomposed canonical at
 * `Pipeline/Mediator/Timing/Waiting.ts` (with siblings
 * `TimingActions.ts` + `WaitTickFactory.ts` + `TimingConfig.ts`) that
 * exports the SAME public surface plus a few more (e.g.
 * `executeWaitUntil` decomposition). Phase 3 C10 (Common ↔ Pipeline
 * unification) collapses Common onto the Pipeline canonical so a
 * single timeout/race/poll/jitter machine wires every callsite in
 * the codebase.
 *
 * <p>The Common-side import surface is preserved verbatim by
 * re-exporting the eight public symbols the existing 7 prod + 2 test
 * importers actually consume:
 *   - `TimeoutError` (BaseScraper, BaseScraper.test)
 *   - `runSerial` (Base*, GenericBankScraper, Mizrahi)
 *   - `humanDelay`, `RACE_TIMED_OUT`, `raceTimeout`, `sleep`,
 *     `waitUntil`, `SECOND` (Tests/Unit/Waiting.test.ts)
 * Pipeline-side callers already import directly from
 * `Pipeline/Mediator/Timing/Waiting.js`; this shim is purely a
 * back-compat layer for the legacy Common-side import paths.
 *
 * <p>After C10, `Common/Config/TimingConfig.ts` is deletable (its
 * sole importer was this file's previous standalone impl) and is
 * removed alongside this shim conversion.
 */
export {
  humanDelay,
  RACE_TIMED_OUT,
  raceTimeout,
  runSerial,
  SECOND,
  sleep,
  TimeoutError,
  waitUntil,
} from '../Scrapers/Pipeline/Mediator/Timing/Waiting.js';

// CR PR #286 F1: preserve type export on the shim so call-sites that imported
// `IWaitUntilOpts` from `Common/Waiting` keep compiling during the v8.5 → v8.6
// deprecation window. Pure type re-export — emits no runtime code.
export type { IWaitUntilOpts } from '../Scrapers/Pipeline/Mediator/Timing/Waiting.js';
