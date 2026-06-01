/**
 * Common-side shim — re-exports the canonical Debug surface from
 * `src/Scrapers/Pipeline/Types/Debug.ts`.
 *
 * <p>Background: Common used to hold its own `getDebug(name)` impl with
 * an eager pino root logger and a raw `module: name` `child()` call,
 * while Pipeline already had a richer 266-line implementation with a
 * deferred-resolve Proxy, lazy root, file transport, runId mixin, and
 * `import.meta.url`-derived kebab module names. Phase 3 C9 (Common ↔
 * Pipeline unification) collapses Common onto the Pipeline canonical so
 * a single pino root + a single redaction/file-transport setup wires
 * every log line in the codebase.
 *
 * <p>The Common-side import surface is preserved verbatim by exporting
 * Pipeline's `getDebugByName` under the legacy name `getDebug`. The
 * existing 9 Common-side callers (BaseScraper, BaseScraperHelpers,
 * BaseScraperWithBrowser, LeumiScraper, BeyahadBishvilhaScraper,
 * MizrahiHelpers, NavigationRetry, plus the two Debug.test +
 * DebugCensor.test suites) keep using `getDebug('manual-name')` /
 * `getDebug(options.companyId)` unchanged — Pipeline's
 * `getDebugByName` passes the name verbatim into pino's
 * `child({ module: name })`, so the `module:` log field value never
 * drifts from what those callers produced before C9.
 *
 * <p>Pipeline-side callers continue using
 * `getDebug(import.meta.url)` directly from the Pipeline module — they
 * get the kebab-derived module name. The two entry points live side
 * by side in `Pipeline/Types/Debug.ts` for the lifetime of the
 * canonical-10 plan; once every legacy caller is migrated (post-Phase 3),
 * this Common shim and the `getDebugByName` adapter can both be
 * removed in a follow-up commit.
 */
export type { ScraperLogger } from '../Scrapers/Pipeline/Types/Debug.js';
export {
  getDebugByName as getDebug,
  runWithBankContext,
} from '../Scrapers/Pipeline/Types/Debug.js';
