/**
 * Test-only builder for options bags that deliberately carry Legacy-only options.
 *
 * <p>Some tests exist to prove what happens when a caller still passes an option
 * that only the Legacy scrapers read (`LEGACY_ONLY_OPTIONS`). Writing such a key
 * straight into a `ScraperOptions` literal is reported by
 * `@typescript-eslint/no-deprecated`, which checks deprecated properties in object
 * literals since https://github.com/typescript-eslint/typescript-eslint/pull/12704.
 * This helper is the one named place where tests opt in: keys are limited to the
 * production manifest and values keep their `ScraperOptions` types, so a
 * typo or a wrong value is still a compile error.
 */

import type { ScraperOptions } from '../../Scrapers/Base/Interface.js';
import type { LegacyOnlyOption } from '../../Scrapers/Pipeline/Core/LegacyOnlyOptions.js';

/**
 * Value type of option `TKey`, read from whichever `ScraperOptions` member declares it.
 * Distributes over the union because some keys, such as `skipCloseBrowser`, exist on
 * one browser-options member only, so `ScraperOptions[TKey]` does not compile.
 */
type OptionValue<TKey extends PropertyKey, TMember = ScraperOptions> = TMember extends unknown
  ? TKey extends keyof TMember
    ? TMember[TKey]
    : never
  : never;

/** Legacy-only options a test sets on purpose, keyed by the production manifest. */
type LegacyOnlyOptionsBag = { readonly [TKey in LegacyOnlyOption]?: OptionValue<TKey> };

/**
 * Returns a copy of the base options with the given Legacy-only options applied.
 * @param base - Options the test would otherwise pass unchanged.
 * @param legacy - Legacy-only options the test sets on purpose.
 * @returns The merged options bag.
 */
export default function withLegacyOnlyOptions(
  base: ScraperOptions,
  legacy: LegacyOnlyOptionsBag,
): ScraperOptions {
  return { ...base, ...legacy };
}
