/**
 * Legacy-only scraper options — the Pipeline guard that makes an ignored
 * option audible instead of silent.
 *
 * <p>`ScraperOptions` is one flat type shared by both scraper paths, but eight
 * of its fields are read only by the deprecated non-Pipeline scrapers. A
 * caller who sets one for a Pipeline bank gets no error, no warning and no
 * effect — the defect reported in issue #540. This module detects that case so
 * the caller hears about it.
 *
 * <p>The warning travels on `process.emitWarning`, not the pipeline logger, for
 * two reasons. The guard runs before `executePipeline` calls `setActiveBank`,
 * so `getLogFile()` is still empty and nothing would reach the run's
 * `pipeline.log`; and off-trace runs in CI or production select
 * `buildSilentOptions` ({@link ../Logging/RootLogger.ts}), which discards the
 * record entirely. A diagnostic the affected caller cannot see would reproduce
 * the very defect it exists to report.
 *
 * <p>Only option *names* are emitted. Values are withheld deliberately —
 * `storeFailureScreenShotPath` carries a filesystem path, and no option is
 * worth leaking into a stderr stream the caller may ship to a log aggregator.
 */

import type { CompanyTypes } from '../../../Definitions.js';
import type { ScraperOptions } from '../../Base/Interface.js';

/**
 * Options declared in the public `ScraperOptions` type that only the
 * deprecated non-Pipeline scrapers implement. Alphabetical, so the warning
 * lists them in a stable order regardless of caller insertion order.
 *
 * <p>Each entry is pinned to its legacy reader; if a Pipeline implementation
 * ever lands, delete the entry here in the same change.
 * - `includeRawTransaction` — `Common/Transactions.ts` `getRawTransaction`
 * - `navigationRetryCount` — `Base/BaseScraperWithBrowser.ts`
 * - `optInFeatures` — `Mizrahi/MizrahiScraper.ts`
 * - `outputData` — `BeyahadBishvilha/BeyahadBishvilhaScraper.ts`
 * - `shouldAddTransactionInformation` — `Mizrahi/MizrahiScraper.ts`
 * - `shouldCombineInstallments` — `Common/Transactions.ts`
 * - `skipCloseBrowser` — `Base/BaseScraperWithBrowser.ts`
 * - `storeFailureScreenShotPath` — `Base/BaseScraperWithBrowser.ts`
 */
export const LEGACY_ONLY_OPTIONS = [
  'includeRawTransaction',
  'navigationRetryCount',
  'optInFeatures',
  'outputData',
  'shouldAddTransactionInformation',
  'shouldCombineInstallments',
  'skipCloseBrowser',
  'storeFailureScreenShotPath',
] as const;

/** One of the option names the Pipeline cannot honour. */
export type LegacyOnlyOption = (typeof LEGACY_ONLY_OPTIONS)[number];

/** Node warning name, so callers can filter on `process.on('warning')`. */
const WARNING_NAME = 'ScraperOptionsWarning';

/** Documentation the warning points at for the full legacy-option table. */
const DOCS_URL = 'https://sergienko4.github.io/israeli-bank-scrapers/architecture/legacy/';

/**
 * Report whether the caller supplied a value for one legacy-only option.
 *
 * <p>Presence is judged on the value, not the key: spreading a partially
 * populated config object yields explicit `undefined` entries that the caller
 * never meant to set, and warning about those would be noise. `false` and `0`
 * count as supplied — a deliberate opt-out is still an expectation the
 * Pipeline silently fails to meet.
 * @param options - Caller-supplied scraper options.
 * @param key - Option name to probe.
 * @returns True when the option holds a defined value.
 */
function isSupplied(options: ScraperOptions, key: LegacyOnlyOption): boolean {
  // ScraperOptions is a union of browser-options arms, and `skipCloseBrowser`
  // lives on only one of them, so TypeScript rejects a direct index and a
  // single-step cast. Widening through `unknown` is the narrowest way to probe
  // a key that is legal on the public type but absent from some arm.
  return (options as unknown as Record<string, unknown>)[key] !== undefined;
}

/**
 * Collect the legacy-only options a caller supplied.
 * @param options - Caller-supplied scraper options.
 * @returns Supplied legacy-only option names, in manifest order.
 */
export function findLegacyOnlyOptions(options: ScraperOptions): LegacyOnlyOption[] {
  return LEGACY_ONLY_OPTIONS.filter(key => isSupplied(options, key));
}

/**
 * Compose the caller-facing warning text.
 * @param companyId - Bank the scrape targets.
 * @param ignored - Legacy-only options the caller supplied.
 * @returns Warning naming the bank and every ignored option, but no values.
 */
function buildMessage(companyId: CompanyTypes, ignored: readonly LegacyOnlyOption[]): string {
  return [
    `"${companyId}" runs on the Pipeline, which does not implement these`,
    `Legacy (deprecated) scraper options: ${ignored.join(', ')}.`,
    'They are ignored here — only the deprecated non-Pipeline scrapers',
    '(Behatsdaa, Beyahad Bishvilha, Mizrahi) read them, and that path is',
    `closed to new work. Remove them, or see ${DOCS_URL}`,
  ].join(' ');
}

/**
 * Warn the caller about every legacy-only option the Pipeline will ignore.
 *
 * <p>Emits at most one warning per call, listing all offending options
 * together, so a caller passing several does not get a burst of stderr noise.
 * @param options - Caller-supplied scraper options.
 * @returns The ignored option names — empty when the bag is clean.
 */
export function warnLegacyOnlyOptions(options: ScraperOptions): LegacyOnlyOption[] {
  const ignored = findLegacyOnlyOptions(options);
  if (ignored.length > 0) {
    const message = buildMessage(options.companyId, ignored);
    process.emitWarning(message, WARNING_NAME);
  }
  return ignored;
}
