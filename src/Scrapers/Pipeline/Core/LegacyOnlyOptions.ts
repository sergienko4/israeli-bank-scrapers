/**
 * Legacy-only scraper options — the Pipeline guard that makes an ignored
 * option audible instead of silent.
 *
 * <p>`ScraperOptions` is one flat type that predates the Pipeline, and eight
 * of its fields have no Pipeline implementation: five were read only by the
 * removed non-Pipeline scrapers, and three have no reader at all. A
 * caller who sets one gets no error, no warning and no
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
import { findSuppliedOptions, warnIgnoredOptions } from './SuppliedOptions.js';

/**
 * Options declared in the public `ScraperOptions` type that the Pipeline does
 * not implement. Alphabetical, so the warning lists them in a stable order
 * regardless of caller insertion order.
 *
 * <p>Each entry names the removed legacy reader it once had, or "no reader"
 * when nothing ever read it; if a Pipeline implementation ever lands, delete
 * the entry here in the same change. Every reader named below was deleted with
 * the legacy scraper chain, so the files are gone from the tree.
 * - `includeRawTransaction` — was the legacy `Common/Transactions.ts` reader
 * - `navigationRetryCount` — was the legacy `BaseScraperWithBrowser` reader
 * - `optInFeatures` — no reader (legacy Mizrahi removed)
 * - `outputData` — was the legacy `BeyahadBishvilhaScraper` reader
 * - `shouldAddTransactionInformation` — no reader (legacy Mizrahi removed)
 * - `shouldCombineInstallments` — no reader
 * - `skipCloseBrowser` — was the legacy `BaseScraperWithBrowser` reader
 * - `storeFailureScreenShotPath` — was the legacy `BaseScraperWithBrowser` reader
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

/** Documentation the warning points at for the full legacy-option table. */
const DOCS_URL = 'https://sergienko4.github.io/israeli-bank-scrapers/architecture/legacy/';

/**
 * Collect the legacy-only options a caller supplied.
 * @param options - Caller-supplied scraper options.
 * @returns Supplied legacy-only option names, in manifest order.
 */
export function findLegacyOnlyOptions(options: ScraperOptions): LegacyOnlyOption[] {
  return findSuppliedOptions(options, LEGACY_ONLY_OPTIONS);
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
    'They are ignored here. The legacy non-Pipeline scrapers that read them',
    'were removed, so they have no effect on any bank.',
    `Remove them, or see ${DOCS_URL}`,
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
  return warnIgnoredOptions(ignored, (names): string => buildMessage(options.companyId, names));
}
