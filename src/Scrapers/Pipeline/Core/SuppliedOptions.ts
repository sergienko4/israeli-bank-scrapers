/**
 * Supply-option probes used by the `createScraper` option guards
 * ({@link ./LegacyOnlyOptions.ts}).
 *
 * <p>Each guard names a set of options the Pipeline ignores and warns once
 * when the caller supplied any of them.
 */

import type { ScraperOptions } from '../../Base/Interface.js';

/** Node warning name, so callers can filter on `process.on('warning')`. */
const WARNING_NAME = 'ScraperOptionsWarning';

/**
 * Report whether the caller supplied a value for one option.
 *
 * <p>Presence is judged on the value, not the key: spreading a partially
 * populated config object yields explicit `undefined` entries that the caller
 * never meant to set, and warning about those would be noise. `false` and `0`
 * count as supplied — a deliberate opt-out is still an expectation the
 * selected path silently fails to meet.
 * @param options - Caller-supplied scraper options.
 * @param key - Option name to probe.
 * @returns True when the option holds a defined value.
 */
function isSupplied(options: ScraperOptions, key: keyof ScraperOptions): boolean {
  return options[key] !== undefined;
}

/**
 * Collect the listed options a caller supplied.
 * @param options - Caller-supplied scraper options.
 * @param names - Option names to probe, in the order the warning lists them.
 * @returns Supplied option names, in `names` order.
 */
export function findSuppliedOptions<T extends keyof ScraperOptions>(
  options: ScraperOptions,
  names: readonly T[],
): T[] {
  return names.filter((key): boolean => isSupplied(options, key));
}

/**
 * Emit one `ScraperOptionsWarning` naming every ignored option, if any.
 *
 * <p>One warning per call lists all offending options together, so a caller
 * passing several does not get a burst of stderr noise. The message is composed
 * only when something is ignored.
 * @param ignored - Supplied option names the selected path ignores.
 * @param compose - Builds the warning text from the ignored names.
 * @returns The ignored option names — empty when the bag is clean.
 */
export function warnIgnoredOptions<T extends string>(
  ignored: T[],
  compose: (names: readonly T[]) => string,
): T[] {
  if (ignored.length > 0) {
    const message = compose(ignored);
    process.emitWarning(message, WARNING_NAME);
  }
  return ignored;
}
